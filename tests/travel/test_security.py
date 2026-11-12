"""Focused auth and abuse-control tests over a tiny ASGI app."""

import asyncio
import contextlib
from contextlib import contextmanager
import hashlib
import hmac
from unittest.mock import AsyncMock
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

from agents.supervisors.travel.security import (
    SecuritySettings,
    TravelSecurityMiddleware,
    clear_auth_cookie,
    is_authenticated,
    issue_cookie,
    set_auth_cookie,
)
from agents.supervisors.travel import main


ORIGIN = "http://localhost:3000"


def make_app(monkeypatch, tmp_path, **env):
    values = {
        "TRAVEL_SECURITY_ENABLED": "true",
        "TRAVEL_ACCESS_KEY": "local-app-secret",
        "TRAVEL_ALLOWED_ORIGINS": ORIGIN,
        "TRAVEL_SECURITY_DB": str(tmp_path / "security.sqlite3"),
        "TRAVEL_PROMPT_RATE_PER_MINUTE": "600",
        "TRAVEL_PROMPT_DAILY_QUOTA": "100",
        "TRAVEL_ACTIVE_PROMPTS": "2",
        "TRAVEL_SEARCH_ENABLED": "true",
        **env,
    }
    for name, value in values.items():
        monkeypatch.setenv(name, value)

    app = FastAPI()
    app.state.calls = 0
    app.state.finished = 0
    settings = SecuritySettings()

    class LoginBody(BaseModel):
        access_key: str = Field(min_length=1, max_length=4096)

    @app.post("/auth/login")
    async def login(body: LoginBody):
        if not settings.access_key:
            return JSONResponse({"detail": "Authentication is not configured"}, status_code=503)
        given = hashlib.sha256(body.access_key.encode()).digest()
        expected = hashlib.sha256(settings.access_key.encode()).digest()
        if not hmac.compare_digest(given, expected):
            return JSONResponse({"detail": "Authentication failed"}, status_code=401)
        response = JSONResponse({"authenticated": True})
        set_auth_cookie(response, issue_cookie(settings.access_key), settings)
        return response

    @app.get("/auth/status")
    async def status(request: Request):
        authenticated, _ = is_authenticated(request.scope, settings)
        return {"authenticated": authenticated}

    @app.post("/auth/logout")
    async def logout():
        response = JSONResponse({"authenticated": False})
        clear_auth_cookie(response, settings)
        return response

    @app.post("/agent/prompt")
    async def prompt():
        app.state.calls += 1
        return {"ok": True}

    @app.post("/agent/prompt/stream")
    async def stream():
        app.state.calls += 1

        async def body():
            try:
                yield b'{"type":"status"}\n'
                await asyncio.Event().wait()
            finally:
                app.state.finished += 1

        return StreamingResponse(body(), media_type="application/x-ndjson")

    @app.delete("/conversations/{conversation_id}")
    async def delete(conversation_id: str):
        return Response(status_code=204)

    app.add_middleware(TravelSecurityMiddleware, allowed_origins=(ORIGIN,))
    return app


def test_unauthorized_and_malformed_authorization_never_call_handler(monkeypatch, tmp_path):
    app = make_app(monkeypatch, tmp_path)
    with TestClient(app) as client:
        assert client.post("/agent/prompt", json={}).status_code == 401
        assert client.post("/agent/prompt", json={}, headers={b"Authorization": b"Bearer \xff"}).status_code == 401
        assert client.post("/agent/prompt", json={}, headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert app.state.calls == 0


def test_cookie_login_origin_checks_expiry_and_logout(monkeypatch, tmp_path):
    app = make_app(monkeypatch, tmp_path)
    with TestClient(app) as client:
        no_origin = client.post("/auth/login", json={"access_key": "local-app-secret"})
        assert no_origin.status_code == 403
        bad_login = client.post("/auth/login", json={"access_key": "wrong"}, headers={"Origin": ORIGIN})
        assert bad_login.status_code == 401
        login = client.post("/auth/login", json={"access_key": "local-app-secret"}, headers={"Origin": ORIGIN})
        assert login.status_code == 200
        cookie = login.cookies["travel_owner"]
        assert "httponly" in login.headers["set-cookie"].lower()
        assert "samesite=lax" in login.headers["set-cookie"].lower()
        assert client.get("/auth/status").json() == {"authenticated": True}
        assert client.post("/agent/prompt", json={}, headers={"Origin": "https://evil.example"}).status_code == 403
        assert client.post("/agent/prompt", json={}, headers={"Origin": ORIGIN}).status_code == 200
        assert client.post("/auth/logout", json={}, headers={"Origin": ORIGIN}).status_code == 200
        assert client.get("/auth/status").json() == {"authenticated": False}

    settings = SecuritySettings()
    # Stateless logout clears this browser's cookie. A copied cookie remains
    # valid until expiry or key rotation; separate tests cover both boundaries.
    assert is_authenticated({"headers": [(b"cookie", f"travel_owner={cookie}".encode())]}, settings)[0]


def test_expired_cookie_and_secret_rotation_invalidate_tokens(monkeypatch, tmp_path):
    monkeypatch.setenv("TRAVEL_ACCESS_KEY", "old-secret")
    token = issue_cookie("old-secret", now=100)
    assert not __import__("agents.supervisors.travel.security", fromlist=["valid_cookie"]).valid_cookie(
        token, "old-secret", now=100 + 8 * 60 * 60
    )
    assert not __import__("agents.supervisors.travel.security", fromlist=["valid_cookie"]).valid_cookie(
        issue_cookie("old-secret", now=1000), "new-secret", now=1001
    )


def test_cross_site_cookie_and_bearer_originless_rules(monkeypatch, tmp_path):
    app = make_app(monkeypatch, tmp_path)
    with TestClient(app) as client:
        client.post("/auth/login", json={"access_key": "local-app-secret"}, headers={"Origin": ORIGIN})
        assert client.post("/agent/prompt", json={}).status_code == 403
        assert client.post("/agent/prompt", json={}, headers={"Origin": ORIGIN}).status_code == 200
        assert client.post("/agent/prompt", json={}, headers={"Authorization": "Bearer local-app-secret"}).status_code == 200
        assert client.post("/agent/prompt", data="{}", headers={"Origin": ORIGIN}).status_code == 403
    assert app.state.calls == 2


def test_missing_secret_fails_closed_and_search_kill_switch(monkeypatch, tmp_path):
    monkeypatch.delenv("TRAVEL_ACCESS_KEY", raising=False)
    app = make_app(monkeypatch, tmp_path, TRAVEL_ACCESS_KEY="")
    with TestClient(app) as client:
        assert client.post("/agent/prompt", json={}, headers={"Authorization": "Bearer anything"}).status_code == 401
        assert client.delete("/conversations/1", headers={"Authorization": "Bearer anything"}).status_code == 401

    app = make_app(monkeypatch, tmp_path, TRAVEL_SEARCH_ENABLED="false")
    with TestClient(app) as client:
        response = client.post("/agent/prompt", json={}, headers={"Authorization": "Bearer local-app-secret"})
        assert response.status_code == 503
        assert "retry-after" not in response.headers
    assert app.state.calls == 0


def test_daily_quota_persists_and_counts_authenticated_attempts(monkeypatch, tmp_path):
    env = {"TRAVEL_PROMPT_DAILY_QUOTA": "1"}
    app = make_app(monkeypatch, tmp_path, **env)
    headers = {"Authorization": "Bearer local-app-secret"}
    with TestClient(app) as client:
        assert client.post("/agent/prompt", json={}, headers=headers).status_code == 200
        assert client.post("/agent/prompt", json={}, headers=headers).status_code == 429
    app = make_app(monkeypatch, tmp_path, **env)
    with TestClient(app) as client:
        assert client.post("/agent/prompt", json={}, headers=headers).status_code == 429


def test_oversized_prompt_is_rejected_before_handler(monkeypatch, tmp_path):
    app = make_app(monkeypatch, tmp_path)
    with TestClient(app) as client:
        response = client.post(
            "/agent/prompt",
            content=b"x" * (64 * 1024 + 1),
            headers={"Authorization": "Bearer local-app-secret", "Content-Type": "application/json"},
        )
    assert response.status_code == 413
    assert app.state.calls == 0


def test_main_app_auth_gate_precedes_paid_handler(monkeypatch, tmp_path):
    monkeypatch.setenv("TRAVEL_SECURITY_ENABLED", "true")
    monkeypatch.setenv("TRAVEL_ACCESS_KEY", "main-app-secret")
    monkeypatch.setenv("TRAVEL_SECURITY_DB", str(tmp_path / "main-security.sqlite3"))
    monkeypatch.setenv("TRAVEL_PROMPT_DAILY_QUOTA", "1")
    monkeypatch.setenv("TRAVEL_PROMPT_RATE_PER_MINUTE", "600")
    calls = AsyncMock(return_value={"response": "ready", "session_id": "execution"})
    monkeypatch.setattr(main, "_conversation_response", calls)

    @contextmanager
    def fake_session_start():
        yield {"executionID": "execution"}

    monkeypatch.setattr(main, "session_start", fake_session_start)
    monkeypatch.setattr(main.app, "middleware_stack", main.app.build_middleware_stack())
    with TestClient(main.app) as client:
        assert client.post("/agent/prompt", json={"prompt": "trip"}).status_code == 401
        assert calls.await_count == 0
        auth = {"Authorization": "Bearer main-app-secret"}
        assert client.post("/agent/prompt", json={"prompt": "trip"}, headers=auth).status_code == 200
        assert client.post("/agent/prompt", json={"prompt": "trip"}, headers=auth).status_code == 429
    assert calls.await_count == 1


def test_login_attempts_are_bounded(monkeypatch, tmp_path):
    app = make_app(monkeypatch, tmp_path)
    with TestClient(app) as client:
        for _ in range(5):
            assert client.post("/auth/login", json={"access_key": "bad"}, headers={"Origin": ORIGIN}).status_code == 401
        response = client.post("/auth/login", json={"access_key": "bad"}, headers={"Origin": ORIGIN})
        assert response.status_code == 429
        assert response.headers["retry-after"] == "300"


def test_concurrent_stream_holds_slot_until_canceled(monkeypatch, tmp_path):
    app = make_app(monkeypatch, tmp_path, TRAVEL_ACTIVE_PROMPTS="1")

    async def exercise():
        application = app.build_middleware_stack()
        auth = [(b"authorization", b"Bearer local-app-secret"), (b"content-type", b"application/json")]

        async def request(path):
            sent = asyncio.Queue()
            delivered = False

            async def receive():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {"type": "http.request", "body": b"{}", "more_body": False}
                await asyncio.Event().wait()

            async def send(message):
                await sent.put(message)

            scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
                     "method": "POST", "scheme": "http", "path": path, "raw_path": path.encode(),
                     "query_string": b"", "headers": auth, "client": ("testclient", 1),
                     "server": ("testserver", 80)}
            task = asyncio.create_task(application(scope, receive, send))
            first = await sent.get()
            status = first["status"] if first["type"] == "http.response.start" else None
            return task, sent, status

        first_task, first_sent, status = await request("/agent/prompt/stream")
        assert status == 200
        await first_sent.get()  # Initial progress chunk means the stream owns the active slot.
        second_task, second_sent, second_status = await request("/agent/prompt")
        assert second_status == 429
        await second_task
        first_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await first_task
        assert app.state.finished == 1
        retry_task, _, retry_status = await request("/agent/prompt")
        assert retry_status == 200
        await retry_task

    asyncio.run(exercise())

