"""A hotel change must preserve the chosen flight and never fabricate a price."""

import asyncio
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableLambda

from agents.supervisors.travel.graph.graph import TravelGraph
from agents.supervisors.travel.graph.models import TravelSearchArgs
from agents.supervisors.travel.graph.recommendations import capture_recommendation, quote_facts
from agents.travel.travel_logic import find_cheapest_plan


def scenario(**overrides):
    start = date.today() + timedelta(days=30)
    trip = TravelSearchArgs(**{
        "origin": "DFW", "destination": "JFK", "destination_city": "New York",
        "start_date": str(start), "end_date": str(start + timedelta(days=3)),
        "budget_amount": 900, "budget_currency": "USD", "budget_scope": "quoted_total",
        **overrides,
    })
    flight = {
        "airline": "Fixture Air", "price": 240, "currency": "USD",
        "departure_code": "DFW", "arrival_code": "JFK",
        "departure_time": f"{start} 10:00", "arrival_time": f"{start} 13:00", "stops": 0,
        "return_flight": {
            "airline": "Fixture Air", "departure_code": "JFK", "arrival_code": "DFW",
            "departure_time": f"{start + timedelta(days=3)} 10:00",
            "arrival_time": f"{start + timedelta(days=3)} 13:00", "stops": 0,
        },
    }
    old_hotel = {"name": "Central", "price": 100, "total_price": 300, "currency": "USD", "overall_rating": 4.6}
    other_hotel = {"name": "Riverside", "price": 125, "total_price": 375, "currency": "USD", "overall_rating": 4.4}
    saved = capture_recommendation(find_cheapest_plan([flight], [old_hotel]), trip)
    return trip, flight, old_hotel, other_hotel, saved


def install(monkeypatch, flights, hotels):
    flight_search = AsyncMock(return_value=flights)
    hotel_search = AsyncMock(return_value=hotels)
    activity_search = AsyncMock()
    monkeypatch.setattr("agents.supervisors.travel.graph.graph.get_flights_via_a2a", flight_search)
    monkeypatch.setattr("agents.supervisors.travel.graph.graph.get_hotels_via_a2a", hotel_search)
    monkeypatch.setattr("agents.supervisors.travel.graph.graph.get_activities_via_a2a", activity_search)
    return flight_search, hotel_search, activity_search


def change(saved):
    return asyncio.run(TravelGraph()._change_hotel_node({"recommendation": saved}))


def test_recent_flight_is_reused_and_only_replacement_hotels_are_searched(monkeypatch):
    trip, flight, old, other, saved = scenario()
    flight_search, hotel_search, activity_search = install(monkeypatch, [flight], [old, other])
    result = change(saved)
    flight_search.assert_not_awaited()
    hotel_search.assert_awaited_once_with("New York", trip.start_date, trip.end_date, party=trip)
    activity_search.assert_not_awaited()
    assert result["recommendation"]["flight"]["id"] == saved["flight"]["id"]
    assert result["recommendation"]["hotel"]["id"] == quote_facts(other, "hotel", trip).id
    assert "USD" in result["budget_assessment"]["message"]
    assert "Total Cost: $615.00" in result["full_response"]
    assert "Activities were not refreshed" in result["full_response"]


def test_expired_quote_is_rechecked_for_same_itinerary_and_new_price(monkeypatch):
    _, flight, old, other, saved = scenario()
    saved["searched_at"] = (datetime.now(timezone.utc) - timedelta(minutes=6)).isoformat()
    repriced = {**flight, "price": 310}
    flight_search, hotel_search, _ = install(monkeypatch, [repriced], [old, other])
    result = change(saved)
    flight_search.assert_awaited_once()
    hotel_search.assert_awaited_once()
    assert result["recommendation"]["flight"]["id"] == saved["flight"]["id"]
    assert result["recommendation"]["flight"]["total_usd"] == 310
    assert "Total Cost: $685.00" in result["full_response"]
    assert "refreshed the same flight itinerary" in result["full_response"]


@pytest.mark.parametrize("current", [[], [{"airline": "Different Air", "price": 250, "currency": "USD"}]])
def test_expired_flight_that_cannot_be_matched_never_switches_silently(monkeypatch, current):
    _, _, old, other, saved = scenario()
    saved["searched_at"] = (datetime.now(timezone.utc) - timedelta(minutes=6)).isoformat()
    flight_search, hotel_search, _ = install(monkeypatch, current, [old, other])
    result = change(saved)
    flight_search.assert_awaited_once()
    hotel_search.assert_not_awaited()
    assert "couldn't verify the same flight" in result["full_response"]
    assert "recommendation" not in result


def test_over_budget_replacement_preserves_previous_selection(monkeypatch):
    _, flight, old, other, saved = scenario(budget_amount=600)
    install(monkeypatch, [flight], [old, other])
    result = change(saved)
    assert result["budget_assessment"]["status"] == "over"
    assert result["budget_assessment"]["quoted_total"] == 615
    assert "kept the earlier recommendation" in result["full_response"]
    assert "recommendation" not in result


def test_provider_failure_and_no_alternative_preserve_previous_selection(monkeypatch):
    _, flight, old, _, saved = scenario()
    _, hotel_search, _ = install(monkeypatch, [flight], [old])
    result = change(saved)
    assert "couldn't find a different hotel" in result["full_response"]
    assert "recommendation" not in result
    hotel_search.side_effect = TimeoutError("private provider URL")
    failed = change(saved)
    assert "couldn't check replacement quotes" in failed["full_response"]
    assert "private provider URL" not in failed["full_response"]


def test_legacy_snapshot_does_not_search_without_reusable_itinerary(monkeypatch):
    _, flight, old, other, saved = scenario()
    saved["version"] = 1
    saved.pop("flight_itinerary")
    flight_search, hotel_search, _ = install(monkeypatch, [flight], [old, other])
    result = change(saved)
    assert "need a recent full-trip search" in result["full_response"]
    flight_search.assert_not_awaited()
    hotel_search.assert_not_awaited()


def test_mixed_request_routes_to_extraction_instead_of_simple_swap():
    graph = TravelGraph()
    graph.supervisor_llm = RunnableLambda(lambda _: AIMessage(content="travel_search"))
    state = {"messages": [HumanMessage(content="Keep the flights, change the hotel and dates")]}
    result = asyncio.run(graph._supervisor_node(state))
    assert result["next_node"] == "travel_search"
