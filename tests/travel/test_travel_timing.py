import asyncio

import pytest

from common import travel_timing


def test_timing_logs_controlled_duration_and_outcome(monkeypatch, caplog):
  async def scenario():
    ticks = iter((10.0, 10.125, 20.0, 20.250, 30.0, 30.500))
    monkeypatch.setattr(travel_timing, "perf_counter", lambda: next(ticks))
    caplog.set_level("INFO", logger="lungo.travel.timing")
    token = travel_timing.set_request_id("opaque-correlation")
    try:
        async with travel_timing.timed("provider", category="flight"):
            pass
        with pytest.raises(ValueError):
            async with travel_timing.timed("extract", category="model"):
                raise ValueError("secret prompt should never appear")
        with pytest.raises(asyncio.CancelledError):
            async with travel_timing.timed("hotel", category="provider"):
                raise asyncio.CancelledError
    finally:
        travel_timing.reset_request_id(token)
    records = [record.getMessage() for record in caplog.records]
    assert all("opaque-correlation" in record for record in records)
    assert '"duration_ms": 125.0' in records[0]
    assert '"outcome": "success"' in records[0]
    assert '"outcome": "error"' in records[1]
    assert '"outcome": "cancelled"' in records[2]
    assert "secret prompt" not in " ".join(records)
  asyncio.run(scenario())
