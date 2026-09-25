"""Bounded, versioned facts for explaining a saved recommendation without search."""

import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field, ValidationError

from .budgets import assessment, money, quote_total
from .models import TravelSearchArgs


class QuoteFacts(BaseModel):
    id: str
    name: str = Field(max_length=160)
    total_usd: float | None = Field(default=None, gt=0, allow_inf_nan=False)


class Recommendation(BaseModel):
    version: Literal[1] = 1
    id: str
    searched_at: datetime
    trip: TravelSearchArgs
    flight: QuoteFacts
    hotel: QuoteFacts
    arrival_time: str
    rating_policy: Literal["standard", "location_relaxed", "overall_relaxed", "unfiltered"]
    combinations_checked: int = Field(ge=1)
    min_overall_rating: float
    min_location_rating: float


def clean_text(value):
    # Provider labels are data, including when rendered as Markdown by the UI.
    return re.sub(r"[<>\[\]*_`&]", "", " ".join(str(value or "Not supplied").split()))[:160]


def quote_facts(quote, kind, trip):
    total = quote_total(quote, kind, trip)
    # Identity includes the query and quoted itinerary, but no provider tokens.
    identity = {
        "kind": kind, "trip": {key: getattr(trip, key) for key in (
            "origin", "destination", "destination_city", "start_date", "end_date",
            "is_one_way", "adults", "children", "children_ages", "rooms",
        )},
        "facts": {key: quote.get(key) for key in (
            "name", "airline", "departure_time", "arrival_time", "price",
            "total_price", "currency", "check_in_date", "check_out_date",
        )},
    }
    identity["return_flight"] = {key: (quote.get("return_flight") or {}).get(key) for key in (
        "airline", "departure_code", "arrival_code", "departure_time", "arrival_time", "stops",
    )}
    digest = hashlib.sha256(json.dumps(identity, sort_keys=True, default=str).encode()).hexdigest()[:24]
    return QuoteFacts(
        id=f"{kind}-{digest}", name=clean_text(quote.get("airline" if kind == "flight" else "name")),
        total_usd=float(total) if total is not None else None,
    )


def capture_recommendation(plan, trip):
    """Retain only display facts and actual decision metadata, never raw payloads."""
    return Recommendation(
        id=str(uuid4()), searched_at=datetime.now(timezone.utc), trip=trip,
        flight=quote_facts(plan["flight"], "flight", trip),
        hotel=quote_facts(plan["hotel"], "hotel", trip),
        arrival_time=clean_text(plan["arrival_time"]),
        **plan["selection"],
    ).model_dump(mode="json")


def explain_recommendation(saved):
    if not saved:
        return "I don't have a saved full-trip recommendation in this chat yet. Ask me to find a flight and hotel first, then ask why I chose them."
    try:
        rec = Recommendation.model_validate(saved)
    except ValidationError:
        return "I can't reliably read the saved recommendation. Please search again before asking me to explain it."
    trip = rec.trip
    stamp = rec.searched_at.strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "**Why this trip?**",
        f"Based on your saved search from {stamp}.",
        f"Route: {clean_text(trip.origin)} to {clean_text(trip.destination)}; {clean_text(trip.start_date)} to {clean_text(trip.end_date)}.",
        trip.label("full_trip"),
        f"- Flight: {rec.flight.name}.",
        f"- Hotel: {rec.hotel.name}.",
    ]
    flight, hotel = rec.flight.total_usd, rec.hotel.total_usd
    if flight is not None and hotel is not None:
        # Reuse Decimal-based price rules rather than model arithmetic.
        total = money(flight) + money(hotel)
        lines.append(f"- Saved price: USD {flight:.2f} flight fare + USD {hotel:.2f} full hotel stay = USD {total:.2f}.")
        lines.append(f"- Selection: lowest combined price among {rec.combinations_checked} eligible returned combinations; this is not a guarantee of the cheapest trip everywhere.")
        if trip.budget_amount is not None:
            lines.append("- At the time of search: " + assessment(trip, total)["message"])
    else:
        lines.append("- The saved quotes lack complete USD prices. I cannot verify their combined cost or claim verified savings.")
    policies = {
        "standard": f"The hotel passed the overall rating filter of {rec.min_overall_rating:g}; the location threshold of {rec.min_location_rating:g} applies only when supplied by the provider.",
        "location_relaxed": f"No hotels passed the initial rating filters. The location threshold was relaxed; the overall threshold remained {rec.min_overall_rating:g}.",
        "overall_relaxed": "No hotels passed the initial rating filters. The search relaxed the overall threshold to 3.0 and dropped the location threshold.",
        "unfiltered": "No hotels passed the rating thresholds, so the search used available hotels without a rating requirement.",
    }
    lines.extend([
        "- Rating rule: " + policies[rec.rating_policy],
        f"- Timing: the selected flight arrives at {rec.arrival_time} and the pair passed the app's check-in compatibility rules. Actual check-in arrangements are not confirmed.",
        "Activities, meals, transfers and unquoted fees are excluded from the flight + hotel total.",
        "This explains a saved quote; prices and availability have not been refreshed. Ask me to search again for current quotes.",
    ])
    return "\n\n".join(lines)
