"""Small, privacy-safe process-local travel timing records."""
from __future__ import annotations

import asyncio
import contextvars
import logging
import json
import uuid
from contextlib import asynccontextmanager
from typing import AsyncIterator
from time import perf_counter

logger = logging.getLogger("lungo.travel.timing")
_request_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("travel_request_id", default=None)


def current_request_id() -> str | None:
    return _request_id.get()


def set_request_id(request_id: str | None = None):
    """Set an opaque correlation id; returns the context token for reset."""
    return _request_id.set(request_id or uuid.uuid4().hex)


def reset_request_id(token) -> None:
    _request_id.reset(token)


@asynccontextmanager
async def timed(stage: str, *, category: str = "travel") -> AsyncIterator[None]:
    """Log duration and success/error/cancellation without input or exception text."""
    started = perf_counter()
    outcome = "success"
    try:
        yield
    except asyncio.CancelledError:
        outcome = "cancelled"
        raise
    except BaseException:
        outcome = "error"
        raise
    finally:
        logger.info("travel_timing %s", json.dumps({
            "stage": stage,
            "category": category,
            "outcome": outcome,
            "duration_ms": round((perf_counter() - started) * 1000, 3),
            "request_id": current_request_id(),
        }))
