"""Benchmark SerpAPI HTTP connection reuse against a local HTTP/1.1 fixture.

This measures client/connection overhead only. It makes no paid provider calls
and does not claim a production latency improvement.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

# Keep both `python scripts/...` and `python -m scripts...` usable.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.travel import serpapi_tools
from agents.travel.provider_http import provider_http_lifespan


class KeepAliveFixture:
    def __init__(self) -> None:
        self.server: asyncio.AbstractServer | None = None
        self.connections = 0
        self.requests = 0
        self.writers: set[asyncio.StreamWriter] = set()

    async def start(self) -> str:
        self.server = await asyncio.start_server(self._handle, "127.0.0.1", 0)
        host, port = self.server.sockets[0].getsockname()[:2]
        return f"http://{host}:{port}/search"

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.connections += 1
        self.writers.add(writer)
        try:
            while True:
                try:
                    line = await reader.readline()
                except (ConnectionError, asyncio.IncompleteReadError):
                    break
                if not line:
                    break
                # Drain headers. The benchmark sends GET requests without bodies.
                while True:
                    header = await reader.readline()
                    if not header or header in (b"\r\n", b"\n"):
                        break
                if not header:
                    break
                self.requests += 1
                payload = b'{"fixture":true}'
                writer.write(
                    b"HTTP/1.1 200 OK\r\n"
                    b"Content-Type: application/json\r\n"
                    + f"Content-Length: {len(payload)}\r\n".encode("ascii")
                    + b"Connection: keep-alive\r\n\r\n"
                    + payload
                )
                await writer.drain()
        finally:
            self.writers.discard(writer)
            writer.close()
            try:
                await writer.wait_closed()
            except (ConnectionError, OSError):
                pass

    async def close(self) -> None:
        if self.server:
            self.server.close()
            await self.server.wait_closed()
        writers = tuple(self.writers)
        for writer in writers:
            writer.close()
        if writers:
            await asyncio.gather(*(writer.wait_closed() for writer in writers), return_exceptions=True)


def percentile95(values: list[float]) -> float:
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * 0.95) - 1)]


def summary(values: list[float]) -> dict[str, float]:
    return {"median_ms": round(statistics.median(values), 3),
            "p95_ms": round(percentile95(values), 3)}


async def run(args: argparse.Namespace) -> None:
    fixture = KeepAliveFixture()
    url = await fixture.start()
    original_url = serpapi_tools.SERPAPI_BASE_URL
    serpapi_tools.SERPAPI_BASE_URL = url
    # Synthetic parameters: this path never consults credentials or calls SerpAPI.
    params = {"engine": "benchmark_fixture", "q": "synthetic"}
    timings: dict[str, dict[str, list[float]]] = {
        mode: {"cold": [], "warm": []} for mode in ("fallback", "pooled")
    }
    per_mode_connections: Counter[str] = Counter()
    per_mode_requests: Counter[str] = Counter()
    try:
        for mode in ("fallback", "pooled"):
            for _ in range(args.samples):
                before_connections, before_requests = fixture.connections, fixture.requests
                if mode == "pooled":
                    first_started = time.perf_counter()
                    async with provider_http_lifespan():
                        for index in range(args.calls_per_sample):
                            started = first_started if index == 0 else time.perf_counter()
                            result = await asyncio.wait_for(
                                serpapi_tools._request_search(params), timeout=10.0
                            )
                            elapsed = (time.perf_counter() - started) * 1000
                            assert result == {"fixture": True}
                            timings[mode]["cold" if index == 0 else "warm"].append(elapsed)
                else:
                    for index in range(args.calls_per_sample):
                        started = time.perf_counter()
                        result = await asyncio.wait_for(
                            serpapi_tools._request_search(params), timeout=10.0
                        )
                        elapsed = (time.perf_counter() - started) * 1000
                        assert result == {"fixture": True}
                        # Every fallback call creates and closes its own client.
                        timings[mode]["cold" if index == 0 else "warm"].append(elapsed)
                actual_requests = fixture.requests - before_requests
                assert actual_requests == args.calls_per_sample, (mode, actual_requests)
                per_mode_requests[mode] += actual_requests
                per_mode_connections[mode] += fixture.connections - before_connections
                if mode == "pooled":
                    assert fixture.connections - before_connections == 1, (
                        "pooled calls did not reuse exactly one TCP connection"
                    )
                else:
                    assert fixture.connections - before_connections == args.calls_per_sample, (
                        "per-call fallback did not open one connection per call"
                    )
    finally:
        serpapi_tools.SERPAPI_BASE_URL = original_url
        await fixture.close()

    expected = args.samples * args.calls_per_sample
    for mode in ("fallback", "pooled"):
        assert per_mode_requests[mode] == expected
    assert fixture.requests == expected * 2
    assert per_mode_connections["fallback"] == expected
    assert per_mode_connections["pooled"] == args.samples

    print(json.dumps({
        "benchmark": "local_http11_provider_pool",
        "samples": args.samples,
        "calls_per_sample": args.calls_per_sample,
        "cold_definition": "first request per sample; pooled timing includes client construction, fallback includes its per-call client lifecycle",
        "warm_definition": "subsequent request per sample; pooled reuses its client, fallback still creates a fresh client and connection",
        "total_requests_per_mode": expected,
        "modes": {
            mode: {
                "accepted_connections": per_mode_connections[mode],
                "requests": per_mode_requests[mode],
                "cold": summary(timings[mode]["cold"]),
                "warm": summary(timings[mode]["warm"]),
            } for mode in ("fallback", "pooled")
        },
        "interpretation": "localhost synthetic transport measurement; no paid calls or production speedup claim",
    }, separators=(",", ":")))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=20, help="independent client lifespans per mode")
    parser.add_argument("--calls-per-sample", type=int, default=5)
    args = parser.parse_args()
    if args.samples < 1 or args.calls_per_sample < 2:
        parser.error("samples must be positive and calls-per-sample must be at least 2")
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
