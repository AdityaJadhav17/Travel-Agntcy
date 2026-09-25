"""Saved explanations must use prior facts without a new provider search."""

import asyncio
import json
import sqlite3
from datetime import date, timedelta
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableLambda

from agents.supervisors.travel import main
from agents.supervisors.travel.conversations import ConversationConflict, ConversationStore
from agents.supervisors.travel.graph.graph import TravelGraph
from agents.supervisors.travel.graph.models import TravelSearchArgs
from agents.supervisors.travel.graph.recommendations import capture_recommendation, explain_recommendation, quote_facts
from agents.travel.travel_logic import find_cheapest_plan


def trip(**updates):
    start = date.today() + timedelta(days=30)
    return TravelSearchArgs(**{
        "origin": "DFW", "destination": "JFK", "destination_city": "New York",
        "start_date": str(start), "end_date": str(start + timedelta(days=3)),
        "budget_amount": 600, "budget_currency": "USD", "budget_scope": "quoted_total", **updates,
    })


def quotes(params, **hotel_updates):
    return (
        {"airline": "Saved Air", "price": 240, "currency": "USD", "arrival_time": f"{params.start_date} 13:00"},
        {"name": "Saved Hotel", "price": 100, "total_price": 300, "currency": "USD", "overall_rating": 4.6, **hotel_updates},
    )


def snapshot(params=None, **hotel_updates):
    params = params or trip()
    flight, hotel = quotes(params, **hotel_updates)
    return capture_recommendation(find_cheapest_plan([flight], [hotel]), params)


def test_saved_explanation_has_grounded_costs_and_search_age():
    saved = snapshot()
    response = explain_recommendation(saved)
    assert "USD 240.00 flight fare + USD 300.00 full hotel stay = USD 540.00" in response
    assert "USD 60.00 remaining" in response
    assert "1 eligible returned combinations" in response
    assert "Saved Hotel" in response and "Saved Air" in response
    assert "saved search from" in response and "UTC" in response
    assert "prices and availability have not been refreshed" in response
    assert "Activities, meals, transfers and unquoted fees are excluded" in response


@pytest.mark.parametrize("rating,location,policy,phrase", [
    (4.6, 4.2, "standard", "passed the overall rating filter"),
    (4.6, 2.0, "location_relaxed", "location threshold was relaxed"),
    (3.2, 2.0, "overall_relaxed", "relaxed the overall threshold to 3.0"),
    (2.0, 2.0, "unfiltered", "without a rating requirement"),
])
def test_explanation_discloses_actual_rating_fallback(rating, location, policy, phrase):
    saved = snapshot(overall_rating=rating, location_rating=location)
    assert saved["rating_policy"] == policy
    assert phrase in explain_recommendation(saved)


def test_unknown_currency_never_becomes_verified_price():
    saved = snapshot(currency="EUR")
    assert saved["hotel"]["total_usd"] is None
    response = explain_recommendation(saved)
    assert "cannot verify" in response
    assert "lowest combined price" not in response
    assert "Within quoted-cost budget" not in response


def test_snapshot_is_bounded_and_omits_provider_tokens():
    params = trip(budget_amount=None)
    flight, hotel = quotes(params, name="<script>" + "x" * 2000)
    hotel["secret_provider_token"] = "not-for-storage"
    saved = capture_recommendation(find_cheapest_plan([flight], [hotel]), params)
    assert len(saved["hotel"]["name"]) <= 160
    assert "<" not in saved["hotel"]["name"]
    assert "not-for-storage" not in json.dumps(saved)
    assert "At the time of search" not in explain_recommendation(saved)
    assert quote_facts(flight, "flight", params).id == saved["flight"]["id"]
    assert quote_facts({**flight, "price": 250}, "flight", params).id != saved["flight"]["id"]
    assert quote_facts(flight, "flight", params.model_copy(update={"budget_amount": 999})).id == saved["flight"]["id"]
    assert quote_facts({**flight, "return_flight": {"airline": "Other Air"}}, "flight", params).id != saved["flight"]["id"]


@pytest.mark.parametrize("saved,phrase", [(None, "don't have a saved"), ({"version": 99}, "can't reliably read")])
def test_absent_or_unsupported_snapshot_requests_search(saved, phrase):
    assert phrase in explain_recommendation(saved)


def test_api_explains_after_restart_without_model_extraction_or_provider_work(tmp_path, monkeypatch):
    store = ConversationStore(tmp_path / "chat.sqlite3")
    monkeypatch.setattr(main, "conversation_store", store)
    graph = TravelGraph()
    graph.supervisor_llm = RunnableLambda(lambda _: AIMessage(content="travel_search"))
    graph.travel_search_llm = object()
    params = trip()
    extract = AsyncMock(return_value=params)
    monkeypatch.setattr(graph, "_extract_travel_params", extract)
    flight, hotel = quotes(params)
    searches = [AsyncMock(return_value=[flight]), AsyncMock(return_value=[hotel]), AsyncMock(return_value=[])]
    for kind, search in zip(("flights", "hotels", "activities"), searches):
        monkeypatch.setattr(f"agents.supervisors.travel.graph.graph.get_{kind}_via_a2a", search)
    monkeypatch.setattr(main, "travel_graph", graph)
    conversation_id = str(uuid4())

    def payload(prompt):
        return {"prompt": prompt, "conversation_id": conversation_id, "request_id": str(uuid4())}

    with TestClient(main.app) as client:
        first = client.post("/agent/prompt", json=payload("Plan my trip")).json()
        saved = first["recommendation"]
        assert saved["hotel"]["name"] == "Saved Hotel"
        monkeypatch.setattr(main, "conversation_store", ConversationStore(store.path))
        restarted_graph = TravelGraph()
        monkeypatch.setattr(main, "travel_graph", restarted_graph)
        # A canonical explanation must even work without a configured model.
        monkeypatch.setattr("agents.supervisors.travel.graph.graph.get_llm", lambda **_: pytest.fail("Unexpected model call"))
        request = payload("Why this one?")
        explained = client.post("/agent/prompt", json=request)
        assert explained.status_code == 200
        assert "USD 540.00" in explained.json()["response"]
        assert explained.json()["recommendation"] == saved
        assert client.post("/agent/prompt", json=request).json() == explained.json()
        extract.assert_awaited_once()
        for search in searches:
            search.assert_awaited_once()
        other = client.post("/agent/prompt", json={**payload("Why this trip?"), "conversation_id": str(uuid4())})
        assert "don't have a saved" in other.json()["response"]
        assert client.delete(f"/conversations/{conversation_id}").status_code == 204
        with store.connect() as db:
            assert db.execute("SELECT count(*) FROM conversation_recommendations").fetchone()[0] == 0


def test_explanation_paraphrases_route_without_extraction(monkeypatch):
    graph = TravelGraph()
    graph.supervisor_llm = RunnableLambda(lambda _: AIMessage(content="explain_recommendation"))
    extract = AsyncMock(side_effect=AssertionError("Must not extract or search"))
    monkeypatch.setattr(graph, "_extract_travel_params", extract)
    result = asyncio.run(graph.serve_conversation("How was that total calculated?", [], trip().model_dump(), snapshot()))
    assert "Why this trip" in result["response"]
    extract.assert_not_awaited()


def test_changed_trip_clarification_clears_previous_selection(monkeypatch):
    graph = TravelGraph()
    graph.supervisor_llm = RunnableLambda(lambda _: AIMessage(content="travel_search"))
    graph.travel_search_llm = object()
    monkeypatch.setattr(graph, "_extract_travel_params", AsyncMock(return_value=trip(destination="BOS", start_date=None)))
    changed = asyncio.run(graph.serve_conversation("Actually Boston, dates undecided", [], trip().model_dump(), snapshot()))
    assert changed["recommendation"] is None
    result = asyncio.run(graph.serve_conversation("Why this one?", [], changed["trip_state"], changed["recommendation"]))
    assert "don't have a saved" in result["response"]


def test_greeting_keeps_saved_selection():
    graph = TravelGraph()
    graph.supervisor_llm = RunnableLambda(lambda _: AIMessage(content="general"))
    saved = snapshot()
    result = asyncio.run(graph.serve_conversation("Hi", [], trip().model_dump(), saved))
    assert result["recommendation"] == saved


def test_legacy_database_and_atomic_snapshot_updates(tmp_path):
    path = tmp_path / "legacy.sqlite3"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE conversations (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, messages TEXT NOT NULL, trip TEXT NOT NULL, requests TEXT NOT NULL)")
        db.execute("INSERT INTO conversations VALUES ('old', 0, '[]', '{}', '{}')")
    db.close()
    store = ConversationStore(path)
    old = store.load("old")
    assert old["recommendation"] is None
    saved = snapshot()
    result = {"response": "Trip found", "trip_state": trip().model_dump(), "recommendation": saved}
    store.save("old", old, "r", "plan", result)
    with pytest.raises(ConversationConflict):
        store.save("old", old, "r2", "outdated", {**result, "recommendation": None})
    assert store.load("old")["recommendation"] == saved
    current = store.load("old")
    store.save("old", current, "r3", "change", {**result, "recommendation": None})
    assert store.load("old")["recommendation"] is None


def test_mixed_change_request_does_not_take_exact_explanation_shortcut():
    graph = TravelGraph()
    graph.supervisor_llm = RunnableLambda(lambda _: AIMessage(content="travel_search"))
    result = asyncio.run(graph._supervisor_node({"messages": [HumanMessage(content="Why this one? Change the destination to Boston.")]}))
    assert result["next_node"] == "travel_search"
