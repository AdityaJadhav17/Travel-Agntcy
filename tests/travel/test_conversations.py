"""Conversation persistence and graph/API boundaries; no provider calls."""

import asyncio
import json
from uuid import uuid4
from unittest.mock import AsyncMock

import pytest
import httpx
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableLambda

from agents.supervisors.travel import main
from agents.supervisors.travel.conversations import ConversationStore, ConversationConflict, ConversationTurns
from agents.supervisors.travel.graph.graph import NodeStates, TravelGraph
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


def test_partial_search_is_atomic_and_removed_with_conversation(store):
    first = store.load("one")
    facts = {"version": 1, "reason": "error", "flights": [{"id": "flight-a"}]}
    store.save("one", first, "r1", "Plan", {"response": "Flights found", "trip_state": {}, "partial_search": facts})
    assert store.load("one")["partial_search"] == facts
    second = store.load("one")
    store.save("one", second, "r2", "Retry hotels", {"response": "Trip found", "trip_state": {}, "partial_search": None})
    assert store.load("one")["partial_search"] is None
    store.delete("one")
    with pytest.raises(ConversationConflict):
        store.load("one")


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


def test_api_rejects_invalid_ids_and_missing_stream_request_id(store):
    with TestClient(main.app) as client:
        assert client.post('/agent/prompt', json=body("hi", "not-a-uuid")).status_code == 422
        assert client.post('/agent/prompt', json={"prompt": "hi", "conversation_id": str(uuid4())}).status_code == 422
        assert client.post('/agent/prompt/stream', json={"prompt": "hi", "conversation_id": str(uuid4())}).status_code == 422
        assert client.post('/agent/prompt', json={"prompt": "x" * 12001}).status_code == 422


def test_conversation_stream_emits_public_events_and_saves_once(store, monkeypatch):
    from agents.supervisors.travel.graph.progress import emit

    async def model(*_):
        emit("status", component="flights", message="Searching flights")
        return {"response": "Flight found", "trip_state": {"origin": "DFW"}}

    monkeypatch.setattr(main.travel_graph, "serve_conversation", model)
    conversation_id = str(uuid4())
    with TestClient(main.app) as client:
        response = client.post('/agent/prompt/stream', json=body("Plan Dallas", conversation_id))
    events = [json.loads(line) for line in response.text.splitlines()]
    assert [event["type"] for event in events] == ["status", "status", "text", "done"]
    assert events[1] == {"type": "status", "component": "flights", "message": "Searching flights"}
    assert events[-1]["result"]["response"] == "Flight found"
    assert store.load(conversation_id)["revision"] == 1


def test_disconnected_stream_cancels_before_saving(store, monkeypatch):
    async def scenario():
        entered = asyncio.Event()

        async def model(*_):
            entered.set()
            await asyncio.Event().wait()

        class Disconnected:
            async def is_disconnected(self):
                return True

        monkeypatch.setattr(main.travel_graph, "serve_conversation", model)
        conversation_id = str(uuid4())
        response = await main.handle_stream_prompt(
            main.PromptRequest(prompt="Plan Dallas", conversation_id=conversation_id, request_id=uuid4()),
            Disconnected(),
        )
        stream = response.body_iterator
        assert json.loads(await anext(stream))["type"] == "status"
        await asyncio.wait_for(entered.wait(), 2)
        with pytest.raises(StopAsyncIteration):
            await anext(stream)
        assert store.load(conversation_id)["revision"] == 0

    asyncio.run(scenario())


def test_overlapping_retries_do_not_repeat_model_work(store, monkeypatch):
    async def scenario():
        entered, finish = asyncio.Event(), asyncio.Event()

        async def model(*_):
            entered.set()
            await finish.wait()
            return {"response": "Where from?", "trip_state": {"destination": "JFK"}}

        turn = AsyncMock(side_effect=model)
        monkeypatch.setattr(main.travel_graph, "serve_conversation", turn)
        monkeypatch.setattr(main, "conversation_turns", ConversationTurns())
        payload = body("Plan New York", str(uuid4()))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
            first = asyncio.create_task(client.post('/agent/prompt', json=payload))
            await asyncio.wait_for(entered.wait(), 2)
            retry = asyncio.create_task(client.post('/agent/prompt', json=payload))
            await asyncio.sleep(0)
            finish.set()
            responses = await asyncio.wait_for(asyncio.gather(first, retry), 5)
            assert [response.status_code for response in responses] == [200, 200]
            assert responses[0].json() == responses[1].json()
            assert turn.await_count == 1
            assert store.load(payload['conversation_id'])['revision'] == 1
            assert not main.conversation_turns._active

    asyncio.run(scenario())


def test_turn_queue_allows_other_chats_and_cleans_cancelled_waiters():
    async def scenario():
        turns = ConversationTurns()
        entered, finish = asyncio.Event(), asyncio.Event()

        async def owner():
            async with turns.acquire('one'):
                entered.set()
                await finish.wait()

        async def waiter():
            async with turns.acquire('one'):
                pytest.fail('Cancelled waiter must not enter')

        task = asyncio.create_task(owner())
        await entered.wait()
        waiting = asyncio.create_task(waiter())
        await asyncio.sleep(0)
        async with turns.acquire('another'):
            assert not task.done()
        waiting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiting
        assert turns._active['one'].users == 1
        finish.set()
        await task
        assert not turns._active
        with pytest.raises(RuntimeError):
            async with turns.acquire('one'):
                raise RuntimeError('Provider failed')
        async with turns.acquire('one'):
            pass
        assert not turns._active

    asyncio.run(scenario())


def test_queued_turn_observes_previous_saved_context(store, monkeypatch):
    async def scenario():
        entered, finish = asyncio.Event(), asyncio.Event()

        async def model(prompt, messages, trip, recommendation=None, partial_search=None):
            if prompt == 'Plan New York':
                entered.set()
                await finish.wait()
                return {"response": "Where from?", "trip_state": {"destination": "JFK"}}
            assert trip == {"destination": "JFK"}
            assert messages[-1]['content'] == 'Where from?'
            return {"response": "What dates?", "trip_state": {**trip, "origin": "DFW"}}

        monkeypatch.setattr(main.travel_graph, "serve_conversation", model)
        monkeypatch.setattr(main, "conversation_turns", ConversationTurns())
        conversation_id = str(uuid4())
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
            first = asyncio.create_task(client.post('/agent/prompt', json=body('Plan New York', conversation_id)))
            await asyncio.wait_for(entered.wait(), 2)
            second = asyncio.create_task(client.post('/agent/prompt', json=body('Dallas', conversation_id)))
            await asyncio.sleep(0)
            finish.set()
            results = await asyncio.wait_for(asyncio.gather(first, second), 5)
            assert [result.status_code for result in results] == [200, 200]
            assert results[1].json()['trip_state'] == {"destination": "JFK", "origin": "DFW"}
            assert store.load(conversation_id)['revision'] == 2

    asyncio.run(scenario())


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


def test_extraction_failure_uses_saved_trip_for_next_question(monkeypatch):
    graph = TravelGraph()
    monkeypatch.setattr(graph, '_extract_travel_params', AsyncMock(side_effect=RuntimeError('model unavailable')))
    saved = {'search_type': 'flight_only', 'destination': 'JFK', 'origin': 'DFW'}
    result = asyncio.run(graph._travel_search_node({
        'messages': [HumanMessage(content='Maybe next weekend')], 'search_params': saved,
    }))
    assert 'date' in result['messages'][0].content.lower()
    assert 'origin, destination, and travel dates' not in result['messages'][0].content
    assert result['search_params'] == saved


def test_general_response_uses_context_and_has_safe_fallback(monkeypatch):
    graph = TravelGraph()
    model = AsyncMock()
    model.ainvoke.return_value = AIMessage(content='You’re welcome! Want to adjust the Dallas to New York trip?')
    def general_model(**kwargs):
        assert kwargs == {}
        return model
    monkeypatch.setattr('agents.supervisors.travel.graph.graph.get_llm', general_model)
    state = {
        'messages': [HumanMessage(content='Thanks!')],
        'search_params': {'origin': 'DFW', 'destination': 'JFK'},
    }
    answer = asyncio.run(graph._general_response_node(state))['messages'][0].content
    assert 'Dallas to New York' in answer
    prompt = model.ainvoke.await_args.args[0]
    assert 'DFW' in prompt[0].content and 'JFK' in prompt[0].content
    assert prompt[-1].content == 'Thanks!'

    model.ainvoke.side_effect = RuntimeError('model unavailable')
    fallback = asyncio.run(graph._general_response_node(state))['messages'][0].content
    assert 'saved trip' in fallback
    assert 'cheapest flight + hotel combinations' not in fallback


def test_intent_model_failure_routes_followup_without_researching_thanks(monkeypatch):
    graph = TravelGraph()
    def unavailable(**_):
        raise RuntimeError('model unavailable')
    monkeypatch.setattr('agents.supervisors.travel.graph.graph.get_llm', unavailable)
    saved = {'origin': 'DFW', 'destination': 'JFK'}
    followup = asyncio.run(graph._supervisor_node({
        'messages': [HumanMessage(content='Make it next Friday')], 'search_params': saved,
    }))
    assert followup['next_node'] == NodeStates.TRAVEL_SEARCH
    thanks = asyncio.run(graph._supervisor_node({
        'messages': [HumanMessage(content='Thanks for the flight help')], 'search_params': saved,
    }))
    assert thanks['next_node'] == NodeStates.GENERAL_INFO


@pytest.mark.parametrize('start,end', [('2027-02-30', None), ('2027-10-24', '2027-10-23'), ('2027-10-24', '2027-10-24')])
def test_invalid_trip_dates_require_correction(start, end):
    assert TravelGraph()._validate_dates(TravelSearchArgs(start_date=start, end_date=end))
