# Copyright AGNTCY Contributors (https://github.com/agntcy)
# SPDX-License-Identifier: Apache-2.0

"""Private HTTP stream for outbound flight progress."""

import asyncio
import json
import os
from collections.abc import AsyncGenerator

from agntcy_app_sdk.common.auth import is_identity_auth_enabled
from starlette.requests import ClientDisconnect, Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.types import Receive, Scope, Send

from agents.flight.agent import FlightSearchAgent
from common.travel_timing import reset_request_id, set_request_id, valid_request_id


PREVIEW_PATH = "/internal/flight-preview"
MAX_QUERY_LENGTH = 2048
MAX_BODY_BYTES = 8192
BODY_TIMEOUT_SECONDS = 5
_ERROR_EVENT = {"type": "error", "message": "Flight search failed."}


def flight_preview_enabled() -> bool:
    identity_requested = os.getenv("IDENTITY_AUTH_ENABLED", "false").strip().lower()
    return (
        os.getenv("TRAVEL_FLIGHT_PREVIEW_ENABLED", "false").strip().lower() == "true"
        and identity_requested not in ("true", "enabled")
        and not is_identity_auth_enabled()
    )


class _PreviewResponse(StreamingResponse):
    """Explicitly monitor disconnects while the generator is waiting for flights."""

    def __init__(self, events: AsyncGenerator[str, None]):
        super().__init__(events, media_type="application/x-ndjson", headers={
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
        })
        self._events = events

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        stream = asyncio.create_task(self.stream_response(send))
        disconnect = asyncio.create_task(self.listen_for_disconnect(receive))
        try:
            done, _ = await asyncio.wait((stream, disconnect), return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        except OSError:
            # ASGI servers may also signal a disconnect through send().
            pass
        finally:
            stream.cancel()
            disconnect.cancel()
            await asyncio.gather(stream, disconnect, return_exceptions=True)
            # A disconnect during send leaves the generator suspended at yield.
            await self._events.aclose()


def _record(event: dict) -> str:
    return json.dumps(event, separators=(",", ":")) + "\n"


async def _flight_events(
    agent: FlightSearchAgent, query: str, timing_id: str | None, verified_preview: bool
) -> AsyncGenerator[str, None]:
    events: asyncio.Queue[dict | None] = asyncio.Queue()
    published: set[str] = set()

    def publish(kind: str, **payload) -> None:
        if kind not in published:
            published.add(kind)
            events.put_nowait({"type": kind, **payload})

    async def search() -> dict:
        token = set_request_id(timing_id)
        try:
            output = await agent.ainvoke(
                query,
                on_outbound_preview=lambda flights: publish("outbound_preview", flights=flights),
                **({"on_verified_preview": lambda flight: publish("verified_flight_preview", flight=flight)}
                   if verified_preview else {}),
            )
            result = json.loads(output)
            if isinstance(result, dict) and result.get("status") == "success":
                return {"type": "done", "output": output}
        except Exception:
            pass
        finally:
            reset_request_id(token)
        return _ERROR_EVENT

    provider = asyncio.create_task(search())
    # The terminal marker follows every progress event published by the task.
    provider.add_done_callback(lambda _: events.put_nowait(None))
    try:
        while (event := await events.get()) is not None:
            yield _record(event)
        yield _record(await provider)
    finally:
        provider.cancel()
        await asyncio.gather(provider, return_exceptions=True)


def flight_preview_endpoint(agent: FlightSearchAgent):
    async def endpoint(request: Request):
        data = bytearray()
        try:
            async with asyncio.timeout(BODY_TIMEOUT_SECONDS):
                async for chunk in request.stream():
                    if len(data) + len(chunk) > MAX_BODY_BYTES:
                        return JSONResponse({"error": "Request is too large."}, status_code=413)
                    data.extend(chunk)
            payload = json.loads(data)
        except TimeoutError:
            return JSONResponse({"error": "Request timed out."}, status_code=408)
        except (ClientDisconnect, ValueError, RecursionError):
            return JSONResponse({"error": "Invalid flight search request."}, status_code=400)

        query = payload.get("query") if isinstance(payload, dict) else None
        if not isinstance(query, str) or not query.strip() or len(query) > MAX_QUERY_LENGTH:
            return JSONResponse({"error": "Invalid flight search query."}, status_code=400)

        incoming_id = payload.get("timing_id")
        timing_id = incoming_id if valid_request_id(incoming_id) else None
        return _PreviewResponse(_flight_events(agent, query, timing_id, payload.get("verified_preview") is True))

    return endpoint
