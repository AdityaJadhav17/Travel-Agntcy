"""Single-owner access control and abuse limits for the local travel API."""

from __future__ import annotations

import hashlib
import hmac
import asyncio
import json
import os
import re
import sqlite3
import threading
import time
from collections import OrderedDict, deque
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from starlette.types import ASGIApp, Message, Receive, Scope, Send


COOKIE_NAME = "travel_owner"
SESSION_SECONDS = 8 * 60 * 60
_COOKIE_RE = re.compile(r"^v1\.(\d{1,12})\.([0-9a-f]{64})$")


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    if value.lower() not in {"true", "false"}:
        raise ValueError(f"{name} must be true or false")
    return value.lower() == "true"


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    value = os.getenv(name, str(default))
    try:
        number = int(value)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if not minimum <= number <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return number


class SecuritySettings:
    def __init__(self) -> None:
        self.enabled = _env_bool("TRAVEL_SECURITY_ENABLED", True)
        self.search_enabled = _env_bool("TRAVEL_SEARCH_ENABLED", True)
        self.cookie_secure = _env_bool("TRAVEL_COOKIE_SECURE", False)
        self.access_key = os.getenv("TRAVEL_ACCESS_KEY") or None
        origins = os.getenv(
            "TRAVEL_ALLOWED_ORIGINS",
            "http://localhost:3000,http://127.0.0.1:3000",
        )
        self.allowed_origins = frozenset(x.strip() for x in origins.split(",") if x.strip())
        if "*" in self.allowed_origins:
            raise ValueError("TRAVEL_ALLOWED_ORIGINS must list explicit origins")
        self.per_minute = _env_int("TRAVEL_PROMPT_RATE_PER_MINUTE", 10, 1, 600)
        self.per_day = _env_int("TRAVEL_PROMPT_DAILY_QUOTA", 100, 1, 100000)
        self.active_limit = _env_int("TRAVEL_ACTIVE_PROMPTS", 2, 1, 100)
        self.db_path = Path(os.getenv("TRAVEL_SECURITY_DB", ".runtime/travel_security.sqlite3"))


def issue_cookie(secret: str, now: int | None = None) -> str:
    expires = (int(time.time()) if now is None else now) + SESSION_SECONDS
    message = f"v1.{expires}".encode()
    signature = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    return f"v1.{expires}.{signature}"


def valid_cookie(value: str | None, secret: str | None, now: int | None = None) -> bool:
    if not value or not secret:
        return False
    match = _COOKIE_RE.fullmatch(value)
    if not match:
        return False
    expires = int(match.group(1))
    current = int(time.time()) if now is None else now
    if expires <= current or expires > current + SESSION_SECONDS:
        return False
    expected = hmac.new(secret.encode(), f"v1.{expires}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(match.group(2), expected)


def _cookie_from_header(scope: Scope) -> str | None:
    for key, value in scope.get("headers", []):
        if key.lower() == b"cookie":
            try:
                parts = value.decode("latin-1").split(";")
            except UnicodeDecodeError:
                return None
            for part in parts:
                name, separator, item = part.strip().partition("=")
                if separator and name == COOKIE_NAME:
                    return item
    return None


def _constant_time_equal(left: str, right: str) -> bool:
    """Compare fixed-size digests so arbitrary Unicode header values cannot raise."""
    left_digest = hashlib.sha256(left.encode("utf-8", errors="surrogatepass")).digest()
    right_digest = hashlib.sha256(right.encode("utf-8", errors="surrogatepass")).digest()
    return hmac.compare_digest(left_digest, right_digest)


def is_authenticated(scope: Scope, settings: SecuritySettings) -> tuple[bool, bool]:
    """Return (authenticated, used_cookie); bearer takes precedence if present."""
    authorization = next(
        (value.decode("latin-1") for key, value in scope.get("headers", []) if key.lower() == b"authorization"),
        None,
    )
    if authorization is not None:
        scheme, _, token = authorization.partition(" ")
        return bool(
            settings.access_key
            and scheme.lower() == "bearer"
            and token
            and _constant_time_equal(token, settings.access_key)
        ), False
    return valid_cookie(_cookie_from_header(scope), settings.access_key), True


def _origin(scope: Scope) -> str | None:
    return next(
        (value.decode("latin-1") for key, value in scope.get("headers", []) if key.lower() == b"origin"),
        None,
    )


def _json_body(scope: Scope) -> bool:
    content_type = next(
        (value.decode("latin-1") for key, value in scope.get("headers", []) if key.lower() == b"content-type"),
        "",
    )
    return content_type.split(";", 1)[0].strip().lower() == "application/json"


class TravelSecurityMiddleware:
    """Auth gate and bounded abuse controls; releases active slots after ASGI completion."""

    def __init__(self, app: ASGIApp, allowed_origins: tuple[str, ...] | None = None) -> None:
        self.app = app
        self.settings = SecuritySettings()
        if allowed_origins is not None:
            self.settings.allowed_origins = frozenset(allowed_origins)
        self._state_lock = threading.Lock()
        self._login_attempts: OrderedDict[str, deque[float]] = OrderedDict()
        self._prompt_attempts: deque[float] = deque()
        self._active = 0
        self._db_lock = threading.Lock()
        if self.settings.enabled:
            self.settings.db_path.parent.mkdir(parents=True, exist_ok=True)
            with closing(sqlite3.connect(self.settings.db_path, timeout=10)) as db, db:
                db.execute("CREATE TABLE IF NOT EXISTS daily_prompt_quota (day TEXT PRIMARY KEY, used INTEGER NOT NULL)")

    async def _respond(self, send: Send, status: int, detail: str, retry_after: int | None = None) -> None:
        payload = json.dumps({"detail": detail}, separators=(",", ":")).encode()
        headers = [(b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode()),
                   (b"cache-control", b"no-store")]
        if retry_after is not None:
            headers.append((b"retry-after", str(retry_after).encode()))
        await send({"type": "http.response.start", "status": status, "headers": headers})
        await send({"type": "http.response.body", "body": payload})

    def _login_limited(self, peer: str) -> bool:
        now = time.monotonic()
        with self._state_lock:
            attempts = self._login_attempts.pop(peer, deque())
            while attempts and attempts[0] <= now - 300:
                attempts.popleft()
            limited = len(attempts) >= 5
            if not limited:
                attempts.append(now)
            self._login_attempts[peer] = attempts
            while len(self._login_attempts) > 1024:
                self._login_attempts.popitem(last=False)
            return limited

    def _prompt_limited(self) -> bool:
        now = time.monotonic()
        with self._state_lock:
            while self._prompt_attempts and self._prompt_attempts[0] <= now - 60:
                self._prompt_attempts.popleft()
            if len(self._prompt_attempts) >= self.settings.per_minute:
                return True
            self._prompt_attempts.append(now)
            return False

    def _take_daily_quota(self) -> bool:
        today = datetime.now(timezone.utc).date().isoformat()
        with self._db_lock, closing(sqlite3.connect(self.settings.db_path, timeout=10, isolation_level=None)) as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT used FROM daily_prompt_quota WHERE day = ?", (today,)).fetchone()
            if row and row[0] >= self.settings.per_day:
                db.execute("ROLLBACK")
                return False
            db.execute(
                "INSERT INTO daily_prompt_quota(day, used) VALUES (?, 1) "
                "ON CONFLICT(day) DO UPDATE SET used = used + 1",
                (today,),
            )
            db.execute("COMMIT")
            return True

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not self.settings.enabled:
            await self.app(scope, receive, send)
            return

        path, method = scope.get("path", ""), scope.get("method", "GET").upper()
        prompt = (method == "POST" and path in {"/agent/prompt", "/agent/prompt/stream"})
        conversation_delete = method == "DELETE" and path.startswith("/conversations/")
        login = method == "POST" and path == "/auth/login"
        logout = method == "POST" and path == "/auth/logout"
        modifying = prompt or conversation_delete or login or logout

        if (prompt or conversation_delete) and not self.settings.access_key:
            await self._respond(send, 401, "Authentication required")
            return

        if login:
            peer = str((scope.get("client") or ("unknown", 0))[0])
            if self._login_limited(peer):
                await self._respond(send, 429, "Too many login attempts", 300)
                return
            origin = _origin(scope)
            if not _json_body(scope) or origin not in self.settings.allowed_origins:
                await self._respond(send, 403, "Request origin not allowed")
                return
        elif logout:
            if _origin(scope) not in self.settings.allowed_origins:
                await self._respond(send, 403, "Request origin not allowed")
                return

        if modifying and not login and not logout:
            authenticated, used_cookie = is_authenticated(scope, self.settings)
            if not authenticated:
                await self._respond(send, 401, "Authentication required")
                return
            if used_cookie and (
                _origin(scope) not in self.settings.allowed_origins
                or (prompt and not _json_body(scope))
            ):
                await self._respond(send, 403, "Request origin not allowed")
                return

        if prompt:
            if not self.settings.search_enabled:
                await self._respond(send, 503, "Travel search is temporarily unavailable")
                return
            if self._prompt_limited():
                await self._respond(send, 429, "Prompt rate limit exceeded", 60)
                return
            with self._state_lock:
                at_capacity = self._active >= self.settings.active_limit
                if not at_capacity:
                    self._active += 1
            if at_capacity:
                await self._respond(send, 429, "Too many active prompts", 5)
                return

            try:
                try:
                    buffered = await asyncio.wait_for(self._buffer_request(receive, 64 * 1024), timeout=10)
                except asyncio.TimeoutError:
                    await self._respond(send, 408, "Request timed out")
                    return
                if buffered is None:
                    await self._respond(send, 413, "Request body too large")
                    return
                try:
                    allowed = await asyncio.to_thread(self._take_daily_quota)
                except sqlite3.Error:
                    await self._respond(send, 503, "Travel search is temporarily unavailable")
                    return
                if not allowed:
                    await self._respond(send, 429, "Daily prompt quota exceeded", 86400)
                    return
                await self.app(scope, buffered, send)
            finally:
                with self._state_lock:
                    self._active -= 1
            return

        if login:
            try:
                buffered = await asyncio.wait_for(self._buffer_request(receive, 64 * 1024), timeout=10)
            except asyncio.TimeoutError:
                await self._respond(send, 408, "Request timed out")
                return
            if buffered is None:
                await self._respond(send, 413, "Request body too large")
                return
            await self.app(scope, buffered, send)
            return

        await self.app(scope, receive, send)

    @staticmethod
    async def _buffer_request(receive: Receive, limit: int) -> Receive | None:
        body = bytearray()
        disconnected = False
        while True:
            message = await receive()
            if message["type"] != "http.request":
                disconnected = message["type"] == "http.disconnect"
                break
            body.extend(message.get("body", b""))
            if len(body) > limit:
                return None
            if not message.get("more_body", False):
                break
        delivered = False

        async def replay() -> Message:
            nonlocal delivered
            if not delivered:
                delivered = True
                if disconnected:
                    return {"type": "http.disconnect"}
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        return replay


def set_auth_cookie(response, token: str, settings: SecuritySettings) -> None:
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_auth_cookie(response, settings: SecuritySettings) -> None:
    response.delete_cookie(COOKIE_NAME, path="/", httponly=True, secure=settings.cookie_secure, samesite="lax")


