"""Controlled return-enrichment benchmark; all provider calls are in-process fixtures."""
import argparse
import asyncio
import json
import math
import os
import statistics
import time

from agents.travel import serpapi_tools


def flight(price: int, token: str) -> dict:
    return {"price": price, "departure_token": token, "flights": [{
        "airline": "Fixture Air", "departure_airport": {"time": "2027-01-01T08:00", "id": "AAA"},
        "arrival_airport": {"time": "2027-01-01T12:00", "id": "BBB"},
    }]}


def returned(price: int) -> dict:
    return {"price": price, "flights": [{
        "airline": "Fixture Air", "departure_airport": {"time": "2027-01-05T08:00", "id": "BBB"},
        "arrival_airport": {"time": "2027-01-05T12:00", "id": "AAA"},
    }]}


async def sample(cap: int, delay: float) -> dict:
    os.environ["TRAVEL_PROVIDER_CONCURRENCY"] = str(cap)
    started = time.perf_counter()
    outbound_done = None
    calls = 0

    async def fixture(params):
        nonlocal outbound_done, calls
        calls += 1
        token = params.get("departure_token")
        if not token:
            outbound_done = (time.perf_counter() - started) * 1000
            return {"best_flights": [flight(i, f"token-{i}") for i in (1, 2, 3)]}
        await asyncio.sleep(delay)
        return {"best_flights": [returned(int(token[-1]) * 100)]}

    original = serpapi_tools._request_search
    serpapi_tools._request_search = fixture
    try:
        results = await serpapi_tools.search_flights("AAA", "BBB", "2027-01-01", "2027-01-05")
    finally:
        serpapi_tools._request_search = original
    done = (time.perf_counter() - started) * 1000
    return {"outbound_ready_ms": round(outbound_done or 0, 3),
            "return_enrichment_ms": round(done - (outbound_done or 0), 3),
            "done_ms": round(done, 3), "result_count": len(results), "provider_calls": calls}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=30)
    parser.add_argument("--delay-ms", type=float, default=100)
    parser.add_argument("--caps", type=int, nargs="+", default=[1, 3], choices=range(1, 11))
    args = parser.parse_args()
    if args.samples < 1 or args.delay_ms < 0:
        parser.error("samples must be positive and delay must be nonnegative")
    for cap in args.caps:
        measurements = []
        for number in range(1, args.samples + 1):
            value = asyncio.run(sample(cap, args.delay_ms / 1000))
            record = {"type": "sample", "scenario": "return_enrichment_fixture",
                      "cap": cap, "sample": number, **value}
            measurements.append(value["return_enrichment_ms"])
            print(json.dumps(record, separators=(",", ":")))
        ordered = sorted(measurements)
        print(json.dumps({"type": "summary", "scenario": "return_enrichment_fixture",
                          "cap": cap, "samples": len(measurements),
                          "median_ms": round(statistics.median(measurements), 3),
                          "p95_ms": round(ordered[max(0, math.ceil(len(ordered) * .95) - 1)], 3)},
                         separators=(",", ":")))


if __name__ == "__main__":
    main()
