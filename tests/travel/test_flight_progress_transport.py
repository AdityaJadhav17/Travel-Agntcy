"""Verify the pinned A2A HTTP server can deliver progress before completion."""

import asyncio

from a2a.server.agent_execution import AgentExecutor
from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import AgentCapabilities, TaskState, TaskStatus, TaskStatusUpdateEvent
from a2a.utils import new_agent_text_message, new_task

from agents.flight.card import AGENT_CARD


def test_native_a2a_http_flushes_progress_while_executor_is_working():
    async def scenario():
        release = asyncio.Event()
        received_progress = asyncio.Event()
        bodies = []
        statuses = []

        class FixtureExecutor(AgentExecutor):
            async def execute(self, context, event_queue):
                task = new_task(context.message)
                await event_queue.enqueue_event(task)
                await event_queue.enqueue_event(TaskStatusUpdateEvent(
                    task_id=task.id,
                    context_id=task.context_id,
                    status=TaskStatus(
                        state=TaskState.working,
                        message=new_agent_text_message("outbound-fixture-ready"),
                    ),
                    final=False,
                ))
                await release.wait()
                await event_queue.enqueue_event(new_agent_text_message("fixture-final"))

            async def cancel(self, context, event_queue):
                release.set()

        card = AGENT_CARD.model_copy(update={"capabilities": AgentCapabilities(streaming=True)})
        app = A2AStarletteApplication(
            agent_card=card,
            http_handler=DefaultRequestHandler(
                agent_executor=FixtureExecutor(), task_store=InMemoryTaskStore(),
            ),
        ).build()
        request = b'''{"jsonrpc":"2.0","id":"fixture","method":"message/stream",
            "params":{"message":{"kind":"message","messageId":"fixture-input",
            "role":"user","parts":[{"kind":"text","text":"fixture"}]}}}'''
        sent_request = False

        async def receive():
            nonlocal sent_request
            if not sent_request:
                sent_request = True
                return {"type": "http.request", "body": request, "more_body": False}
            await asyncio.Future()

        async def send(message):
            if message["type"] == "http.response.start":
                statuses.append(message["status"])
                assert dict(message["headers"])[b"content-type"].startswith(b"text/event-stream")
            elif message["type"] == "http.response.body":
                bodies.append(message.get("body", b""))
                if b"outbound-fixture-ready" in b"".join(bodies):
                    received_progress.set()

        scope = {
            "type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"},
            "method": "POST", "path": "/", "headers": [(b"content-type", b"application/json")],
            "scheme": "http", "query_string": b"", "server": ("localhost", 80),
        }
        serving = asyncio.create_task(app(scope, receive, send))
        try:
            await asyncio.wait_for(received_progress.wait(), 3)
            assert statuses == [200]
            assert b"fixture-final" not in b"".join(bodies)
            assert not serving.done()
        finally:
            release.set()
            await asyncio.wait_for(serving, 3)
        assert b"fixture-final" in b"".join(bodies)

    asyncio.run(scenario())
