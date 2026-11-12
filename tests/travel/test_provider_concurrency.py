import asyncio

import pytest

from agents.travel import serpapi_tools as serp


def _flight(price, token):
    return {"price": price, "departure_token": token, "flights": [{
        "airline": "Test Air", "departure_airport": {"time": "2027-01-01T08:00", "id": "AAA"},
        "arrival_airport": {"time": "2027-01-01T12:00", "id": "BBB"},
    }]}


def _return(price):
    return {"price": price, "flights": [{
        "airline": "Test Air", "departure_airport": {"time": "2027-01-05T08:00", "id": "BBB"},
        "arrival_airport": {"time": "2027-01-05T12:00", "id": "AAA"},
    }]}


def test_return_lookups_overlap_and_share_cap_across_searches(monkeypatch):
  async def scenario():
    monkeypatch.setenv("TRAVEL_PROVIDER_CONCURRENCY", "3")
    active = maximum = 0
    three_started = asyncio.Event()

    async def fake(params):
        nonlocal active, maximum
        if not params.get("departure_token"):
            return {"best_flights": [_flight(n, f"t{n}") for n in (1, 2, 3)]}
        active += 1
        maximum = max(maximum, active)
        if active == 3:
            three_started.set()
        await asyncio.wait_for(three_started.wait(), 2)
        await asyncio.sleep(0)
        active -= 1
        return {"best_flights": [_return(int(params["departure_token"][1:]) * 10)]}

    monkeypatch.setattr(serp, "_request_search", fake)
    left, right = await asyncio.gather(
        serp.search_flights("AAA", "BBB", "2027-01-01", "2027-01-05"),
        serp.search_flights("AAA", "BBB", "2027-01-01", "2027-01-05"),
    )
    assert maximum == 3
    assert [[f["price"] for f in left], [f["price"] for f in right]] == [[10, 20, 30], [10, 20, 30]]
  asyncio.run(scenario())


def test_cap_one_is_serial_and_missing_tokens_are_skipped(monkeypatch):
  async def scenario():
    monkeypatch.setenv("TRAVEL_PROVIDER_CONCURRENCY", "1")
    active = maximum = calls = 0

    async def fake(params):
        nonlocal active, maximum, calls
        if not params.get("departure_token"):
            return {"best_flights": [_flight(1, "a"), _flight(2, None), _flight(3, "c")]}
        calls += 1
        active += 1
        maximum = max(maximum, active)
        await asyncio.sleep(0)
        active -= 1
        return {"best_flights": [_return(99)]}

    monkeypatch.setattr(serp, "_request_search", fake)
    result = await serp.search_flights("AAA", "BBB", "2027-01-01", "2027-01-05")
    assert (calls, maximum) == (2, 1)
    assert [flight["price"] for flight in result] == [99, 2, 99]
  asyncio.run(scenario())


def test_zero_and_one_candidate_and_fatal_failure_cancels_siblings(monkeypatch):
  async def scenario():
    monkeypatch.setenv("TRAVEL_PROVIDER_CONCURRENCY", "3")
    started = asyncio.Event()
    cancelled = 0

    async def fake(params):
        nonlocal cancelled
        if not params.get("departure_token"):
            return {"best_flights": [_flight(1, "a"), _flight(2, "b"), _flight(3, "c")]}
        token = params["departure_token"]
        if token == "a":
            await started.wait()
            raise RuntimeError("safe provider failure")
        started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled += 1
            raise

    monkeypatch.setattr(serp, "_request_search", fake)
    with pytest.raises(RuntimeError, match="safe provider failure"):
        await serp.search_flights("AAA", "BBB", "2027-01-01", "2027-01-05")
    assert cancelled == 2

    async def empty(params):
        return {"best_flights": []}

    monkeypatch.setattr(serp, "_request_search", empty)
    assert await serp.search_flights("AAA", "BBB", "2027-01-01", "2027-01-05") == []

    async def one(params):
        return {"best_flights": [_flight(1, "only")] if not params.get("departure_token")
                else [_return(12)]}

    monkeypatch.setattr(serp, "_request_search", one)
    result = await serp.search_flights("AAA", "BBB", "2027-01-01", "2027-01-05")
    assert len(result) == 1 and result[0]["price"] == 12

    requested = []

    async def many(params):
        if not params.get("departure_token"):
            return {"best_flights": [_flight(n, f"t{n}") for n in range(1, 6)]}
        requested.append(params["departure_token"])
        return {"best_flights": [_return(20)]}

    monkeypatch.setattr(serp, "_request_search", many)
    results = await serp.search_flights("AAA", "BBB", "2027-01-01", "2027-01-05")
    assert len(requested) == 3
    assert [flight["departure_token"] for flight in results] == ["t1", "t2", "t3", "t4", "t5"]
  asyncio.run(scenario())


def test_external_cancellation_awaits_all_return_workers(monkeypatch):
  async def scenario():
    monkeypatch.setenv("TRAVEL_PROVIDER_CONCURRENCY", "3")
    all_started = asyncio.Event()
    started = cancelled = 0

    async def fake(params):
        nonlocal started, cancelled
        if not params.get("departure_token"):
            return {"best_flights": [_flight(n, f"t{n}") for n in (1, 2, 3)]}
        started += 1
        if started == 3:
            all_started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled += 1
            raise

    monkeypatch.setattr(serp, "_request_search", fake)
    search = asyncio.create_task(serp.search_flights("AAA", "BBB", "2027-01-01", "2027-01-05"))
    await asyncio.wait_for(all_started.wait(), 2)
    search.cancel()
    with pytest.raises(asyncio.CancelledError):
        await search
    assert cancelled == 3
  asyncio.run(scenario())
