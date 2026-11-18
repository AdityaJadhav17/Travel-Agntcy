import asyncio
import json
import logging

import httpx
import pytest

from agents.travel import provider_http as pool
from agents.travel import serpapi_tools as serp


class Client:
    def __init__(self):
        self.is_closed = False
        self.closed = 0
        self.calls = []

    async def get(self, url, *, params):
        self.calls.append(dict(params))
        request = httpx.Request("GET", url)
        return httpx.Response(200, request=request, json={"ok": True})

    async def aclose(self):
        self.closed += 1
        self.is_closed = True

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.aclose()


def test_lifespan_reuses_and_nested_owner_closes_once(monkeypatch):
    clients = []
    monkeypatch.setattr(pool, "_new_client", lambda: clients.append(Client()) or clients[-1])

    async def scenario():
        async with pool.provider_http_lifespan() as outer:
            async with pool.provider_http_lifespan() as inner:
                assert inner is outer
            assert not outer.is_closed
        assert outer.closed == 1
        async with pool.provider_http_lifespan() as fresh:
            assert fresh is not outer
        assert fresh.closed == 1

    asyncio.run(scenario())
    assert len(clients) == 2


def test_standalone_calls_are_scoped(monkeypatch):
    clients = []
    monkeypatch.setattr(pool, "_new_client", lambda: clients.append(Client()) or clients[-1])
    async def scenario():
        await serp._request_search({"api_key": "secret-a", "q": "first"})
        await serp._request_search({"api_key": "secret-b", "q": "second"})
    asyncio.run(scenario())
    assert len(clients) == 2
    assert all(client.closed == 1 for client in clients)
    assert clients[0].calls == [{"api_key": "secret-a", "q": "first"}]
    assert clients[1].calls == [{"api_key": "secret-b", "q": "second"}]


def test_lifespan_reuses_client_without_query_state_or_cookies(monkeypatch):
    clients = []
    monkeypatch.setattr(pool, "_new_client", lambda: clients.append(Client()) or clients[-1])
    async def scenario():
        async with pool.provider_http_lifespan() as owner:
            await serp._request_search({"api_key": "secret-a", "q": "first"})
            await serp._request_search({"api_key": "secret-b", "q": "second"})
            assert owner.calls == [
                {"api_key": "secret-a", "q": "first"},
                {"api_key": "secret-b", "q": "second"},
            ]
    asyncio.run(scenario())
    assert len(clients) == 1 and clients[0].closed == 1


def test_return_lookup_times_headers_and_body_without_logging_request_data(monkeypatch, caplog):
    class Body(httpx.AsyncByteStream):
        async def __aiter__(self):
            assert "return_lookup_headers" in caplog.text
            assert "return_lookup_body" not in caplog.text
            yield b'{"best_flights":[]}'

    async def respond(request):
        assert request.url.params["departure_token"] == "fixture-token"
        assert request.url.params["api_key"] == "fixture-key"
        return httpx.Response(200, stream=Body())

    async def scenario():
        async with pool.provider_http_lifespan():
            return await serp._request_provider({
                "engine": "google_flights", "departure_token": "fixture-token", "api_key": "fixture-key",
            })

    monkeypatch.setattr(pool, "_new_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(respond)))
    with caplog.at_level(logging.INFO, logger="lungo.travel.timing"):
        assert asyncio.run(scenario()) == {"best_flights": []}

    records = [
        json.loads(record.getMessage().removeprefix("travel_timing "))
        for record in caplog.records
        if record.name == "lungo.travel.timing"
    ]
    assert [(record["stage"], record["category"]) for record in records] == [
        ("provider_queue", "provider"),
        ("return_lookup_headers", "provider_http"),
        ("return_lookup_body", "provider_http"),
        ("return_lookup", "provider"),
    ]
    assert all(record["outcome"] == "success" for record in records)
    assert "fixture-token" not in caplog.text
    assert "fixture-key" not in caplog.text


def test_cancelled_return_lookup_closes_response(monkeypatch):
    async def scenario():
        reading = asyncio.Event()
        closed = asyncio.Event()

        class SlowBody(httpx.AsyncByteStream):
            async def __aiter__(self):
                reading.set()
                await asyncio.Future()
                yield b"{}"

            async def aclose(self):
                closed.set()

        transport = httpx.MockTransport(lambda _: httpx.Response(200, stream=SlowBody()))
        monkeypatch.setattr(pool, "_new_client", lambda: httpx.AsyncClient(transport=transport))
        async with pool.provider_http_lifespan():
            task = asyncio.create_task(serp._request_search({"departure_token": "fixture-token"}))
            await asyncio.wait_for(reading.wait(), timeout=2)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert closed.is_set()

    asyncio.run(scenario())


def test_each_event_loop_gets_and_closes_its_own_client(monkeypatch):
    clients = []
    monkeypatch.setattr(pool, "_new_client", lambda: clients.append(Client()) or clients[-1])
    async def scenario():
        async with pool.provider_http_lifespan() as client:
            return client
    first = asyncio.run(scenario())
    second = asyncio.run(scenario())
    assert first is not second
    assert [item.closed for item in clients] == [1, 1]


def test_cancellation_closes_scoped_fallback(monkeypatch):
    clients = []
    monkeypatch.setattr(pool, "_new_client", lambda: clients.append(Client()) or clients[-1])
    async def scenario():
        async def cancel_inside():
            async with pool.provider_http_client():
                raise asyncio.CancelledError
        with pytest.raises(asyncio.CancelledError):
            await cancel_inside()
    asyncio.run(scenario())
    assert clients[0].closed == 1


def test_cancellation_closes_lifespan_client_once(monkeypatch):
    clients = []
    monkeypatch.setattr(pool, "_new_client", lambda: clients.append(Client()) or clients[-1])
    async def scenario():
        entered = asyncio.Event()
        async def owner():
            async with pool.provider_http_lifespan():
                entered.set()
                await asyncio.Event().wait()
        task = asyncio.create_task(owner())
        await entered.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    asyncio.run(scenario())
    assert len(clients) == 1 and clients[0].closed == 1


def test_cancellation_during_lifespan_close_waits_for_transport(monkeypatch):
    closing = asyncio.Event()
    release = asyncio.Event()
    class SlowClose(Client):
        async def aclose(self):
            closing.set()
            await release.wait()
            await super().aclose()
    client = SlowClose()
    monkeypatch.setattr(pool, "_new_client", lambda: client)
    async def scenario():
        async def owner():
            async with pool.provider_http_lifespan():
                pass
        task = asyncio.create_task(owner())
        await closing.wait()
        task.cancel()
        await asyncio.sleep(0)
        assert not task.done()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
    asyncio.run(scenario())
    assert client.closed == 1


def test_http_errors_keep_url_credentials_redacted(monkeypatch):
    class Broken(Client):
        async def get(self, url, *, params):
            request = httpx.Request("GET", "https://serpapi.com/search?api_key=leaky")
            response = httpx.Response(401, request=request)
            raise httpx.HTTPStatusError("leaky", request=request, response=response)
    monkeypatch.setattr(pool, "_new_client", Broken)
    async def scenario():
        async with pool.provider_http_lifespan():
            with pytest.raises(RuntimeError) as error:
                await serp._request_search({"api_key": "leaky"})
            assert "401" in str(error.value)
            assert "leaky" not in str(error.value)
    asyncio.run(scenario())


def test_cookie_policy_rejects_response_cookies():
    jar = pool._NoCookiesPolicy()
    cookie = httpx.Cookies({"session": "secret"}).jar
    sample = next(iter(cookie))
    request = httpx.Request("GET", "https://example.test")
    assert not jar.set_ok(sample, request)
    assert not jar.return_ok(sample, request)


def test_mock_transport_does_not_persist_or_send_set_cookie(monkeypatch):
    seen = []
    async def handler(request):
        seen.append(request.headers.get("cookie"))
        return httpx.Response(
            200, json={"ok": True},
            headers={"set-cookie": "session=credential; Path=/"}, request=request,
        )
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler), cookies=pool.CookieJar(policy=pool._NoCookiesPolicy()))
    monkeypatch.setattr(pool, "_new_client", lambda: client)
    async def scenario():
        async with pool.provider_http_lifespan():
            await serp._request_search({"api_key": "one", "q": "first"})
            await serp._request_search({"api_key": "two", "q": "second"})
    asyncio.run(scenario())
    assert seen == [None, None]
    assert list(client.cookies.jar) == []


def test_explicit_timeouts_and_limits(monkeypatch):
    monkeypatch.setenv("TRAVEL_PROVIDER_CONCURRENCY", "4")
    real_client = httpx.AsyncClient
    captured = {}
    def factory(**kwargs):
        captured.update(kwargs)
        return real_client(**kwargs)
    monkeypatch.setattr(pool.httpx, "AsyncClient", factory)
    client = pool._new_client()
    try:
        assert captured["timeout"] == httpx.Timeout(
            60.0, connect=60.0, read=60.0, write=60.0, pool=60.0,
        )
        assert captured["limits"].max_connections == 4
        assert captured["limits"].max_keepalive_connections == 4
        assert client.timeout.connect == 60
        assert client.timeout.read == 60
        assert client.timeout.write == 60
        assert client.timeout.pool == 60
        assert client._transport._pool._max_connections == 4
        assert client._transport._pool._max_keepalive_connections == 4
    finally:
        asyncio.run(client.aclose())


@pytest.mark.parametrize("value", ["0", "11", "bad"])
def test_connection_limit_validation(monkeypatch, value):
    monkeypatch.setenv("TRAVEL_PROVIDER_CONCURRENCY", value)
    with pytest.raises(ValueError, match="TRAVEL_PROVIDER_CONCURRENCY"):
        pool.provider_concurrency_limit()


@pytest.mark.parametrize("value", ["1", "3", "10"])
def test_connection_limit_range(monkeypatch, value):
    monkeypatch.setenv("TRAVEL_PROVIDER_CONCURRENCY", value)
    assert pool.provider_concurrency_limit() == int(value)
