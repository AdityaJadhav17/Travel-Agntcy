import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from a2a.types import Message, Part, Role, TextPart
from a2a.utils.errors import ServerError

from common import travel_timing


def test_timing_ids_are_task_local():
    async def worker(value):
        token = travel_timing.set_request_id(value)
        try:
            await asyncio.sleep(0)
            return travel_timing.current_request_id()
        finally:
            travel_timing.reset_request_id(token)

    async def main():
        values = [uuid4().hex, uuid4().hex]
        assert await asyncio.gather(*(worker(value) for value in values)) == values
        assert travel_timing.current_request_id() is None

    asyncio.run(main())


@pytest.mark.parametrize(
    "module_name,class_name",
    [
        ("agents.flight.agent_executor", "FlightAgentExecutor"),
        ("agents.hotel.agent_executor", "HotelAgentExecutor"),
        ("agents.activity.agent_executor", "ActivityAgentExecutor"),
    ],
)
@pytest.mark.parametrize("incoming", ["valid", "invalid", "missing"])
def test_each_executor_sets_and_resets_correlation_id(module_name, class_name, incoming):
    import importlib

    module = importlib.import_module(module_name)
    executor = getattr(module, class_name)()
    observed = []

    async def invoke(_prompt):
        observed.append(travel_timing.current_request_id())
        return "{}"

    executor.agent.ainvoke = invoke
    metadata = {"travel_timing_id": uuid4().hex} if incoming == "valid" else (
        {"travel_timing_id": "malicious arbitrary text"} if incoming == "invalid" else None
    )
    message = Message(
        messageId="message",
        role=Role.user,
        metadata=metadata,
        parts=[Part(TextPart(text="search"))],
    )
    context = SimpleNamespace(
        message=message,
        current_task=object(),
        get_user_input=lambda: "search",
    )
    queue = SimpleNamespace(enqueue_event=AsyncMock())

    async def scenario():
        parent_id = uuid4().hex
        parent_token = travel_timing.set_request_id(parent_id)
        try:
            await executor.execute(context, queue)
            assert travel_timing.current_request_id() == parent_id
        finally:
            travel_timing.reset_request_id(parent_token)

    asyncio.run(scenario())
    assert len(observed) == 1
    if incoming == "valid":
        assert observed[0] == metadata["travel_timing_id"]
    else:
        assert travel_timing.valid_request_id(observed[0])


def test_supervisor_a2a_message_metadata_serializes_and_carries_current_id(monkeypatch):
    from agents.supervisors.travel.graph import tools

    correlation_id = uuid4().hex
    captured = {}

    class Client:
        async def send_message(self, request):
            captured["request"] = request
            return SimpleNamespace(root=SimpleNamespace(result=SimpleNamespace(parts=[SimpleNamespace(root=SimpleNamespace(text="ok"))])))

    class Factory:
        async def create_client(self, *_args, **_kwargs):
            return Client()

    monkeypatch.setattr(tools, "get_factory", lambda: Factory())
    monkeypatch.setattr(tools, "_get_transport", lambda: object())
    monkeypatch.setattr(tools.A2AProtocol, "create_agent_topic", lambda _card: "topic")
    token = travel_timing.set_request_id(correlation_id)
    try:
        assert asyncio.run(tools._send_a2a_message(SimpleNamespace(name="Flight"), "query")) == "ok"
    finally:
        travel_timing.reset_request_id(token)

    message = captured["request"].params.message
    assert message.metadata == {"travel_timing_id": correlation_id}
    assert message.model_dump(mode="json", by_alias=True)["metadata"]["travel_timing_id"] == correlation_id


@pytest.mark.parametrize(
    "module_name,class_name",
    [
        ("agents.flight.agent_executor", "FlightAgentExecutor"),
        ("agents.hotel.agent_executor", "HotelAgentExecutor"),
        ("agents.activity.agent_executor", "ActivityAgentExecutor"),
    ],
)
@pytest.mark.parametrize("failure,expected", [
    (ValueError("safe failure"), ServerError),
    (asyncio.CancelledError(), asyncio.CancelledError),
])
def test_executor_restores_parent_id_on_error_and_cancellation(module_name, class_name, failure, expected):
    import importlib

    module = importlib.import_module(module_name)
    executor = getattr(module, class_name)()
    observed = []

    async def invoke(_prompt):
        observed.append(travel_timing.current_request_id())
        raise failure

    executor.agent.ainvoke = invoke
    message = Message(
        messageId="message",
        role=Role.user,
        metadata={"travel_timing_id": uuid4().hex},
        parts=[Part(TextPart(text="search"))],
    )
    context = SimpleNamespace(message=message, current_task=object(), get_user_input=lambda: "search")
    queue = SimpleNamespace(enqueue_event=AsyncMock())

    async def scenario():
        parent_id = uuid4().hex
        parent_token = travel_timing.set_request_id(parent_id)
        try:
            with pytest.raises(expected):
                await executor.execute(context, queue)
            assert travel_timing.current_request_id() == parent_id
        finally:
            travel_timing.reset_request_id(parent_token)

    asyncio.run(scenario())
    assert observed == [message.metadata["travel_timing_id"]]
