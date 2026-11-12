import asyncio
from contextlib import asynccontextmanager
from importlib import import_module
from types import SimpleNamespace

import pytest

from agents.travel import service_lifecycle


def test_http_exit_drains_transport_before_pool_closes(monkeypatch):
    async def scenario():
        events = []

        @asynccontextmanager
        async def pool():
            events.append("pool-open")
            try:
                yield object()
            finally:
                events.append("pool-close")

        async def transport():
            try:
                events.append("transport-start")
                await asyncio.Event().wait()
            finally:
                events.append("transport-drain")

        async def http():
            events.append("http-exit")

        monkeypatch.setattr(service_lifecycle, "provider_http_lifespan", pool)
        await service_lifecycle.run_service(http, transport)
        assert events == ["pool-open", "transport-start", "http-exit", "transport-drain", "pool-close"]

    asyncio.run(scenario())


def test_nats_only_service_remains_alive_until_cancelled(monkeypatch):
    async def scenario():
        events = []

        @asynccontextmanager
        async def pool():
            events.append("pool-open")
            try:
                yield object()
            finally:
                events.append("pool-close")

        async def transport():
            try:
                events.append("transport-start")
                await asyncio.Event().wait()
            finally:
                events.append("transport-stop")

        monkeypatch.setattr(service_lifecycle, "provider_http_lifespan", pool)
        task = asyncio.create_task(service_lifecycle.run_service(None, transport))
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert not task.done()
        assert "pool-close" not in events
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert events[-2:] == ["transport-stop", "pool-close"]

    asyncio.run(scenario())


def test_nats_only_service_stops_when_signal_handler_fires(monkeypatch):
    async def scenario():
        loop = asyncio.get_running_loop()
        handlers = {}
        removed = []
        monkeypatch.setattr(loop, "add_signal_handler", lambda sig, callback: handlers.__setitem__(sig, callback))
        monkeypatch.setattr(loop, "remove_signal_handler", lambda sig: removed.append(sig) or True)
        stopped = asyncio.Event()

        @asynccontextmanager
        async def pool():
            try:
                yield object()
            finally:
                stopped.set()

        monkeypatch.setattr(service_lifecycle, "provider_http_lifespan", pool)
        task = asyncio.create_task(service_lifecycle.run_service(None, lambda: asyncio.Event().wait()))
        await asyncio.sleep(0)
        handlers[service_lifecycle.signal.SIGTERM]()
        await asyncio.wait_for(task, 1)
        assert stopped.is_set()
        assert set(removed) == set(handlers)

    asyncio.run(scenario())


def test_transport_failure_cancels_http_before_pool_closes(monkeypatch):
    async def scenario():
        events = []

        @asynccontextmanager
        async def pool():
            try:
                yield object()
            finally:
                events.append("pool-close")

        async def transport():
            await asyncio.sleep(0)
            raise RuntimeError("transport failed")

        async def http():
            try:
                await asyncio.Event().wait()
            finally:
                events.append("http-drain")

        monkeypatch.setattr(service_lifecycle, "provider_http_lifespan", pool)
        with pytest.raises(RuntimeError, match="transport failed"):
            await service_lifecycle.run_service(http, transport)
        assert events == ["http-drain", "pool-close"]

    asyncio.run(scenario())


@pytest.mark.parametrize("module_name", ["agents.flight.server", "agents.hotel.server", "agents.activity.server"])
def test_each_transport_stops_its_session_on_cancellation(monkeypatch, module_name):
    async def scenario():
        module = import_module(module_name)
        events = []

        async def event(name):
            events.append(name)

        session = SimpleNamespace(
            add_app_container=lambda *args: events.append("container"),
            start_session=lambda *args: event("start"),
            stop_all_sessions=lambda: event("stop"),
        )
        monkeypatch.setattr(module, "A2AProtocol", SimpleNamespace(create_agent_topic=lambda card: "topic"))
        monkeypatch.setattr(module, "AppContainer", lambda *args, **kwargs: object())
        monkeypatch.setattr(module, "factory", SimpleNamespace(
            create_transport=lambda *args, **kwargs: object(), create_app_session=lambda **kwargs: session
        ))
        task = asyncio.create_task(module.run_transport(object(), "NATS", "nats://mock"))
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert events == ["container", "start", "stop"]

    asyncio.run(scenario())


def test_supervisor_fastapi_lifespan_owns_provider_pool(monkeypatch):
    async def scenario():
        from agents.supervisors.travel import main as supervisor

        events = []

        @asynccontextmanager
        async def pool():
            events.append("open")
            try:
                yield object()
            finally:
                events.append("close")

        monkeypatch.setattr(supervisor, "provider_http_lifespan", pool)
        async with supervisor.lifespan(supervisor.app):
            assert events == ["open"]
        assert events == ["open", "close"]

    asyncio.run(scenario())
