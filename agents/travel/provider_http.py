"""Loop-local SerpAPI HTTP client pooling with explicit lifecycle ownership."""
from __future__ import annotations

import asyncio
import os
import weakref
from contextlib import asynccontextmanager
from http.cookiejar import CookieJar, DefaultCookiePolicy

import httpx


class _NoCookiesPolicy(DefaultCookiePolicy):
    def set_ok(self, cookie, request):
        return False

    def return_ok(self, cookie, request):
        return False


_clients: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()
_owners: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()


def provider_concurrency_limit() -> int:
    try:
        value = int(os.getenv("TRAVEL_PROVIDER_CONCURRENCY", "3"))
    except (TypeError, ValueError):
        raise ValueError("TRAVEL_PROVIDER_CONCURRENCY must be an integer from 1 to 10") from None
    if not 1 <= value <= 10:
        raise ValueError("TRAVEL_PROVIDER_CONCURRENCY must be an integer from 1 to 10")
    return value


def _new_client() -> httpx.AsyncClient:
    limit = provider_concurrency_limit()
    return httpx.AsyncClient(
        timeout=httpx.Timeout(60.0, connect=60.0, read=60.0, write=60.0, pool=60.0),
        limits=httpx.Limits(max_connections=limit, max_keepalive_connections=limit),
        cookies=CookieJar(policy=_NoCookiesPolicy()),
    )


@asynccontextmanager
async def provider_http_lifespan():
    """Own the shared provider client for this event loop; nested owners are safe."""
    loop = asyncio.get_running_loop()
    client = _clients.get(loop)
    if client is None or client.is_closed:
        client = _new_client()
        _clients[loop] = client
    _owners[loop] = _owners.get(loop, 0) + 1
    try:
        yield client
    finally:
        count = _owners.get(loop, 1) - 1
        if count:
            _owners[loop] = count
        else:
            _owners.pop(loop, None)
            if _clients.get(loop) is client:
                _clients.pop(loop, None)
                close_task = asyncio.create_task(client.aclose())
                try:
                    await asyncio.shield(close_task)
                except asyncio.CancelledError:
                    # Keep shutdown ownership until the transport has actually closed.
                    await close_task
                    raise


@asynccontextmanager
async def provider_http_client():
    """Yield the loop's lifespan client, or a safely scoped standalone client."""
    loop = asyncio.get_running_loop()
    client = _clients.get(loop)
    if client is not None and not client.is_closed and _owners.get(loop, 0):
        yield client
        return
    async with _new_client() as client:
        yield client
