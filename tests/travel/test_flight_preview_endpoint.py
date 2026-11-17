"""Exercise the private HTTP stream with fixture outbound and return fares."""

import asyncio
import json
from uuid import uuid4

import pytest
from starlette.applications import Starlette
from starlette.routing import Route

from agents.flight.agent import FlightSearchAgent
from agents.flight.preview import PREVIEW_PATH, flight_preview_enabled, flight_preview_endpoint
from agents.travel import serpapi_tools
from common.travel_timing import current_request_id, valid_request_id


def test_preview_switch_is_opt_in_and_disabled_when_identity_is_requested(monkeypatch):
    monkeypatch.delenv("TRAVEL_FLIGHT_PREVIEW_ENABLED", raising=False)
    monkeypatch.setenv("IDENTITY_AUTH_ENABLED", "false")
    assert not flight_preview_enabled()
    monkeypatch.setenv("TRAVEL_FLIGHT_PREVIEW_ENABLED", "true")
    assert flight_preview_enabled()
    monkeypatch.delenv("IDENTITY_SERVICE_API_KEY", raising=False)
    monkeypatch.setenv("IDENTITY_AUTH_ENABLED", "true")
    assert not flight_preview_enabled()


@pytest.mark.parametrize("disconnect", [False, True])
def test_preview_precedes_return_fares_and_disconnect_drains_provider(monkeypatch, disconnect):
    async def scenario():
        allow_returns = asyncio.Event()
        return_started = asyncio.Event()
        return_stopped = asyncio.Event()
        outbound_sent = asyncio.Event()
        disconnect_client = asyncio.Event()
        never = asyncio.Event()
        records = []
        calls = []
        correlation_id = uuid4().hex
        supplied_id = "invalid|correlation" if disconnect else correlation_id

        legs = [{
            "airline": "Example Air",
            "departure_airport": {"id": "SAN", "time": "2026-12-01 09:15"},
            "arrival_airport": {"id": "DFW", "time": "2026-12-01 14:15"},
        }]

        async def request_search(params):
            calls.append((params.get("departure_token"), current_request_id()))
            if not params.get("departure_token"):
                return {"best_flights": [
                    {"price": 250, "flights": legs, "departure_token": "outbound-token"}
                ]}
            return_started.set()
            try:
                await allow_returns.wait()
                return {"best_flights": [{"price": 300, "flights": legs}]}
            finally:
                await asyncio.sleep(0)
                return_stopped.set()

        monkeypatch.setattr(serpapi_tools, "SERPAPI_API_KEY", "fixture-key")
        monkeypatch.setattr(serpapi_tools, "_request_search", request_search)
        app = Starlette(routes=[
            Route(PREVIEW_PATH, flight_preview_endpoint(FlightSearchAgent()), methods=["POST"])
        ])
        request = json.dumps({
            "query": "origin:SAN destination:DFW outbound:2026-12-01 return:2026-12-02",
            "timing_id": supplied_id,
        }).encode()
        sent = False

        async def receive():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": request, "more_body": False}
            await disconnect_client.wait()
            return {"type": "http.disconnect"}

        async def send(message):
            if message["type"] == "http.response.start":
                assert message["status"] == 200
                assert dict(message["headers"])[b"content-type"] == b"application/x-ndjson"
            elif message.get("body"):
                records.append(json.loads(message["body"]))
                if records[-1]["type"] == "outbound_preview":
                    outbound_sent.set()
                    if disconnect:
                        await never.wait()

        serving = asyncio.create_task(app({
            "type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"},
            "method": "POST", "path": PREVIEW_PATH, "headers": [],
            "scheme": "http", "query_string": b"", "server": ("localhost", 80),
        }, receive, send))
        try:
            await asyncio.wait_for(outbound_sent.wait(), 3)
            await asyncio.wait_for(return_started.wait(), 3)
            assert records == [{"type": "outbound_preview", "flights": [{
                "airline": "Example Air", "departure_time": "2026-12-01 09:15",
                "arrival_time": "2026-12-01 14:15", "stops": 0,
            }]}]
            assert not serving.done()
            if disconnect:
                disconnect_client.set()
            else:
                allow_returns.set()
            await asyncio.wait_for(serving, 3)
            assert return_stopped.is_set()
        finally:
            serving.cancel()
            await asyncio.gather(serving, return_exceptions=True)

        assert [token for token, _ in calls] == [None, "outbound-token"]
        assert calls[0][1] == calls[1][1]
        assert valid_request_id(calls[0][1])
        if disconnect:
            assert len(records) == 1
        else:
            assert calls[0][1] == correlation_id
            assert records[1]["type"] == "done"
            final = json.loads(records[1]["output"])
            assert final["flights"][0]["price"] == 300
            assert final["flights"][0]["return_flight"]["price"] == 300

    asyncio.run(scenario())
