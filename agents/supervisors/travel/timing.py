"""Request timings without logging prompts, credentials, URLs or response bodies."""

import asyncio
import json
import logging
import time

from common.travel_timing import reset_request_id, set_request_id, current_request_id

logger = logging.getLogger("lungo.travel.timing")


class TravelTimingMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("path") not in {
            "/agent/prompt", "/agent/prompt/stream",
        }:
            await self.app(scope, receive, send)
            return
        token = set_request_id()
        started = time.perf_counter()
        status = None
        first_body_ms = None
        outcome = "completed"

        async def measured_send(message):
            nonlocal status, first_body_ms
            if message["type"] == "http.response.start":
                status = message["status"]
                # A server-generated opaque ID joins browser and backend timings.
                # Never trust a caller-provided identifier as log content.
                headers = [(key, value) for key, value in message.get("headers", [])
                           if key.lower() != b"x-travel-timing-id"]
                headers.append((b"x-travel-timing-id", current_request_id().encode("ascii")))
                message = {**message, "headers": headers}
            if message["type"] == "http.response.body" and message.get("body") and first_body_ms is None:
                first_body_ms = round((time.perf_counter() - started) * 1000, 3)
            await send(message)

        try:
            await self.app(scope, receive, measured_send)
        except asyncio.CancelledError:
            outcome = "cancelled"
            raise
        except BaseException:
            outcome = "error"
            raise
        finally:
            logger.info("travel_request_timing %s", json.dumps({
                "request_id": current_request_id(),
                "mode": "stream" if scope["path"].endswith("/stream") else "response",
                "outcome": "rejected" if outcome == "completed" and status and status >= 400 else outcome,
                "http_status": status,
                "first_body_ms": first_body_ms,
                "duration_ms": round((time.perf_counter() - started) * 1000, 3),
            }, separators=(",", ":")))
            reset_request_id(token)
