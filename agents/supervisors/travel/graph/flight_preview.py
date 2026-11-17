"""Consume the private flight stream and publish transient outbound options."""

import json
import os

import httpx
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError
from typing import Annotated

from agents.supervisors.travel.graph.progress import emit, progress_sink
from common.travel_timing import current_request_id, timed


class OutboundFlight(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")

    airline: str = Field(min_length=1, max_length=200)
    departure_time: str = Field(min_length=1, max_length=64)
    arrival_time: str = Field(min_length=1, max_length=64)
    stops: int = Field(ge=0, le=20)


_options = TypeAdapter(Annotated[list[OutboundFlight], Field(min_length=1, max_length=3)])
_max_event_bytes = 1024 * 1024


def preview_enabled() -> bool:
    return (
        os.getenv("TRAVEL_FLIGHT_PREVIEW_ENABLED", "false").lower() == "true"
        and os.getenv("IDENTITY_AUTH_ENABLED", "false").lower() not in {"true", "enabled"}
        and progress_sink.get() is not None
    )


class FlightPreviewError(RuntimeError):
    pass


async def fetch_flight_preview(url: str, query: str) -> str:
    """Make one request. A failed stream must not launch a second search."""
    try:
        async with timed("flight_preview_round_trip", category="flight"):
            async with httpx.AsyncClient(trust_env=False, timeout=20.0) as client:
                async with client.stream("POST", url, json={
                    "query": query, "timing_id": current_request_id(),
                }) as response:
                    response.raise_for_status()
                    if response.headers.get("content-type", "").split(";", 1)[0] != "application/x-ndjson":
                        raise FlightPreviewError("Flight preview service returned an invalid response.")
                    pending = bytearray()
                    published = False
                    async for chunk in response.aiter_bytes(chunk_size=None):
                        pending.extend(chunk)
                        while (end := pending.find(b"\n")) != -1:
                            if end > _max_event_bytes:
                                raise FlightPreviewError("Flight preview service returned an oversized event.")
                            line = pending[:end]
                            del pending[:end + 1]
                            if not line.strip():
                                continue
                            event = json.loads(line)
                            if not isinstance(event, dict):
                                continue
                            if event.get("type") == "outbound_preview" and not published:
                                try:
                                    options = _options.validate_python(event.get("flights"))
                                except ValidationError:
                                    continue
                                emit("outbound_preview", flights=[option.model_dump() for option in options])
                                published = True
                            elif event.get("type") == "done" and isinstance(event.get("output"), str):
                                return event["output"]
                            elif event.get("type") == "error":
                                raise FlightPreviewError("Flight search did not complete. Please retry.")
                        if len(pending) > _max_event_bytes:
                            raise FlightPreviewError("Flight preview service returned an oversized event.")
    except (httpx.HTTPError, ValueError):
        raise FlightPreviewError("Flight preview service could not complete the search. Please retry.") from None
    raise FlightPreviewError("Flight preview stream ended before the search completed. Please retry.")
