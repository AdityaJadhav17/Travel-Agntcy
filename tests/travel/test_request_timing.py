import asyncio
import json
import logging

from agents.supervisors.travel.timing import TravelTimingMiddleware
from common.travel_timing import current_request_id


def test_request_timings_are_distinct_reset_and_do_not_expose_input(caplog):
    ids = []

    async def app(scope, receive, send):
        ids.append(current_request_id())
        await send({"type": "http.response.start", "status": 401})
        await send({"type": "http.response.body", "body": b"private response"})

    async def run():
        async def receive():
            return {"type": "http.request", "body": b"private prompt"}

        async def send(message):
            pass

        middleware = TravelTimingMiddleware(app)
        for _ in range(2):
            await middleware({"type": "http", "path": "/agent/prompt", "headers": [(b"authorization", b"secret")]}, receive, send)
            assert current_request_id() is None

    with caplog.at_level(logging.INFO, logger="lungo.travel.timing"):
        asyncio.run(run())
    assert len(set(ids)) == 2
    rows = [json.loads(record.message.removeprefix("travel_request_timing ")) for record in caplog.records]
    assert all(row["outcome"] == "rejected" and row["duration_ms"] >= 0 for row in rows)
    assert "private" not in caplog.text and "secret" not in caplog.text
