"""Conversation persistence and graph/API boundaries; no provider calls."""

import asyncio
import json
from uuid import uuid4
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableLambda

from agents.supervisors.travel import main
from agents.supervisors.travel.conversations import ConversationStore, ConversationConflict
from agents.supervisors.travel.graph.graph import TravelGraph
from agents.supervisors.travel.graph.models import TravelSearchArgs


@pytest.fixture
def store(tmp_path, monkeypatch):
    repository = ConversationStore(tmp_path / "conversations.sqlite3")
    monkeypatch.setattr(main, "conversation_store", repository)
    return repository


def body(prompt, conversation_id, request_id=None):
    return {"prompt": prompt, "conversation_id": conversation_id, "request_id": request_id or str(uuid4())}


def test_restart_isolation_and_revision_conflicts(store):
    snapshot = store.load("one")
    result = {"response": "Where from?", "trip_state": {"destination": "JFK"}}
    store.save("one", snapshot, "request", "Plan New York", result)
    restarted = ConversationStore(store.path)
    assert restarted.load("one")["trip"] == {"destination": "JFK"}
    assert restarted.load("two")["messages"] == []
    with pytest.raises(ConversationConflict):
        restarted.save("one", snapshot, "other", "stale turn", result)


def test_delete_prevents_inflight_save_and_recreation(store):
    snapshot = store.load("one")
    store.delete("one")
    with pytest.raises(ConversationConflict):
        store.save("one", snapshot, "r", "hello", {"response": "hi", "trip_state": {}})
    with pytest.raises(ConversationConflict, match="deleted"):
        store.load("one")


def test_concurrent_writers_do_not_lose_updates(store):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    barrier = Barrier(2)

    def write_turn(name):
        snapshot = store.load("shared")
        barrier.wait(timeout=5)
        try:
            store.save("shared", snapshot, name, name, {"response": name, "trip_state": {}})
            return "saved"
        except ConversationConflict:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(write_turn, ['first', 'second']))
    assert sorted(results) == ['conflict', 'saved']
    assert store.load("shared")["revision"] == 1


def test_context_and_request_cache_are_bounded(store):
    for index in range(25):
        saved = store.load("one")
        store.save("one", saved, str(index), str(index), {"response": "reply", "trip_state": {"destination": "JFK"}})
    saved = store.load("one")
    assert len(saved["messages"]) == 40
    assert len(saved["requests"]) == 10
    assert saved["trip"]["destination"] == "JFK"


def test_api_retry_failure_and_delete(store, monkeypatch):
    turn = AsyncMock(return_value={"response": "Where from?", "trip_state": {"destination": "JFK"}})
    monkeypatch.setattr(main.travel_graph, "serve_conversation", turn)
    conversation_id = str(uuid4())
    request = body("Plan New York", conversation_id)
    with TestClient(main.app) as client:
        first = client.post('/agent/prompt', json=request)
        assert first.status_code == 200
        assert client.post('/agent/prompt', json=request).json() == first.json()
        assert turn.await_count == 1
        assert client.post('/agent/prompt', json={**request, "prompt": "different"}).status_code == 409
        turn.side_effect = RuntimeError("private provider detail")
        failed = client.post('/agent/prompt', json=body("Dallas", conversation_id))
        assert failed.status_code == 500
        assert "private provider detail" not in failed.text
        assert store.load(conversation_id)["revision"] == 1
        assert client.delete(f'/conversations/{conversation_id}').status_code == 204
        assert client.post('/agent/prompt', json=body("Dallas", conversation_id)).status_code == 409


def test_api_rejects_invalid_ids_and_unsupported_stream_memory(store):
    with TestClient(main.app) as client:
        assert client.post('/agent/prompt', json=body("hi", "not-a-uuid")).status_code == 422
        assert client.post('/agent/prompt', json={"prompt": "hi", "conversation_id": str(uuid4())}).status_code == 422
        assert client.post('/agent/prompt/stream', json=body("hi", str(uuid4()))).status_code == 400
        assert client.post('/agent/prompt', json={"prompt": "x" * 12001}).status_code == 422


def test_multiturn_graph_clarification_correction_and_restart(store, monkeypatch):
    graph = TravelGraph()
    graph.supervisor_llm = RunnableLambda(lambda _: AIMessage(content="travel_search"))
    graph.travel_search_llm = object()
    captured = []

    async def extract(context):
        context = json.loads(context)
        captured.append(context)
        trip = dict(context["saved_trip"])
        if context["latest_user_message"] == "Plan New York":
            trip.update(destination="JFK", destination_city="New York")
        elif context["latest_user_message"] == "Dallas":
            trip.update(origin="DFW")
        else:
            trip.update(destination="BOS", destination_city="Boston")
        return TravelSearchArgs(**trip)

    monkeypatch.setattr(graph, '_extract_travel_params', extract)
    monkeypatch.setattr(main, 'travel_graph', graph)
    conversation_id = str(uuid4())
    with TestClient(main.app) as client:
        first = client.post('/agent/prompt', json=body("Plan New York", conversation_id)).json()
        assert "flying from" in first["response"]
        second = client.post('/agent/prompt', json=body("Dallas", conversation_id)).json()
        assert "date" in second["response"]
        assert second["trip_state"]["destination"] == "JFK"
        assert captured[1]["recent_conversation"][-2]["content"] == first["response"]
        monkeypatch.setattr(main, 'conversation_store', ConversationStore(store.path))
        third = client.post('/agent/prompt', json=body("Actually Boston", conversation_id)).json()
        assert third["trip_state"]["origin"] == "DFW"
        assert third["trip_state"]["destination"] == "BOS"
        assert "date" in third["response"]


@pytest.mark.parametrize('kind,oneway,end,expected', [
    ('flight_only', False, None, 'return'),
    ('flight_only', True, None, None),
    ('full_trip', True, None, 'check-out'),
    ('hotel_only', False, None, 'check-out'),
])
def test_required_dates_do_not_assume_one_way(kind, oneway, end, expected):
    params = TravelSearchArgs(search_type=kind, origin='DFW', destination='JFK', start_date='2027-10-24', end_date=end, is_one_way=oneway)
    question = TravelGraph._missing_details(params)
    assert question is None if expected is None else expected in question


def test_ambiguity_does_not_call_search(monkeypatch):
    graph = TravelGraph()
    graph.travel_search_llm = object()
    monkeypatch.setattr(graph, '_extract_travel_params', AsyncMock(return_value=TravelSearchArgs(clarification_question="Which Portland?")))
    search = AsyncMock()
    monkeypatch.setattr(graph, '_handle_full_trip_search', search)
    from langchain_core.messages import HumanMessage
    result = asyncio.run(graph._travel_search_node({"messages": [HumanMessage(content="Portland")]}))
    assert result["messages"][0].content == "Which Portland?"
    search.assert_not_awaited()


@pytest.mark.parametrize('start,end', [('2027-02-30', None), ('2027-10-24', '2027-10-23'), ('2027-10-24', '2027-10-24')])
def test_invalid_trip_dates_require_correction(start, end):
    assert TravelGraph()._validate_dates(TravelSearchArgs(start_date=start, end_date=end))
