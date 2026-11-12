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


class FlightItinerary(BaseModel):
    """Only the fields needed to reuse or recheck the selected flight."""

    price: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    currency: str = Field(default="", max_length=3)
    airline: str = Field(default="", max_length=160)
    departure_time: str = Field(default="", max_length=80)
    departure_code: str = Field(default="", max_length=8)
    arrival_time: str = Field(default="", max_length=80)
    arrival_code: str = Field(default="", max_length=8)
    stops: int = Field(default=0, ge=0)
    duration_minutes: int = Field(default=0, ge=0)
    return_flight: "ReturnItinerary | None" = None


class ReturnItinerary(BaseModel):
    airline: str = Field(default="", max_length=160)
    departure_time: str = Field(default="", max_length=80)
    departure_code: str = Field(default="", max_length=8)
    arrival_time: str = Field(default="", max_length=80)
    arrival_code: str = Field(default="", max_length=8)
    stops: int = Field(default=0, ge=0)
    duration_minutes: int = Field(default=0, ge=0)


class Recommendation(BaseModel):
    version: Literal[1, 2] = 2
    id: str
    searched_at: datetime
    trip: TravelSearchArgs
    flight: QuoteFacts
    flight_itinerary: FlightItinerary | None = None
    hotel: QuoteFacts
    arrival_time: str
    rating_policy: Literal["standard", "location_relaxed", "overall_relaxed", "unfiltered"]
    combinations_checked: int = Field(ge=1)
    min_overall_rating: float
    min_location_rating: float
    timing_status: Literal["compatible", "needs_confirmation"] = "needs_confirmation"
    timing_reason_codes: list[str] = Field(default_factory=list, max_length=12)
    timing_message: str = Field(default="", max_length=400)
    accommodation_status: Literal["matched", "unknown"] = "unknown"
    accommodation_reasons: list[str] = Field(default_factory=list, max_length=12)


class FlightRecommendation(BaseModel):
    """The lowest complete USD fare among the displayed flight-only options."""

    version: Literal[3] = 3
    kind: Literal["flight_only"] = "flight_only"
    searched_at: datetime
    trip: TravelSearchArgs
    flight: QuoteFacts
    itinerary: FlightItinerary
    option_number: int = Field(ge=1, le=5)
    priced_options_checked: int = Field(ge=1, le=5)


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
        "facts": ({"name": clean_text(quote.get("name"))} if kind == "hotel" else {
            key: quote.get(key) for key in (
                "airline", "departure_time", "arrival_time", "departure_code", "arrival_code", "stops",
            )
        }),
    }
    # Keep legacy quote IDs stable. Explicit stay-date changes affect a hotel
    # quote identity; lodging preferences and flight quote IDs do not.
    if kind == "hotel":
        # Legacy hotel quotes already used flight trip dates in the identity.
        # Only add a date component when the explicit stay changes those dates,
        # so an explicit stay equal to the defaults preserves the old ID.
        default_in = getattr(trip, "start_date", None)
        default_out = getattr(trip, "end_date", None)
        hotel_dates = {
            key: value for key, value in (
                ("check_in", getattr(trip, "hotel_check_in_date", None)
                 if getattr(trip, "hotel_check_in_date", None) != default_in else None),
                ("check_out", getattr(trip, "hotel_check_out_date", None)
                 if getattr(trip, "hotel_check_out_date", None) != default_out else None),
            ) if value
        }
        if hotel_dates:
            identity["explicit_hotel_dates"] = hotel_dates
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
    itinerary = FlightItinerary.model_validate(plan["flight"]).model_dump()
    for field in ("airline", "departure_time", "departure_code", "arrival_time", "arrival_code"):
        if itinerary[field]:
            itinerary[field] = clean_text(itinerary[field])[:80 if "time" in field else 160]
    if itinerary["return_flight"]:
        for field in ("airline", "departure_time", "departure_code", "arrival_time", "arrival_code"):
            if itinerary["return_flight"][field]:
                itinerary["return_flight"][field] = clean_text(itinerary["return_flight"][field])[:80 if "time" in field else 160]
    return Recommendation(
        id=str(uuid4()), searched_at=datetime.now(timezone.utc), trip=trip,
        flight=quote_facts(plan["flight"], "flight", trip),
        flight_itinerary=FlightItinerary.model_validate(itinerary),
        hotel=quote_facts(plan["hotel"], "hotel", trip),
        arrival_time=clean_text(plan["arrival_time"]),
        timing_status=plan.get("timing_status", "needs_confirmation"),
        timing_reason_codes=(plan.get("timing_assessment") or {}).get("timing_reason_codes", [])[:12],
        timing_message=clean_text((plan.get("timing_assessment") or {}).get("timing_message", ""))[:400],
        accommodation_status=plan.get("accommodation_status", "unknown"),
        accommodation_reasons=(plan.get("accommodation_assessment") or {}).get("reasons", [])[:12],
        **plan["selection"],
    ).model_dump(mode="json")


def capture_flight_recommendation(flights, trip):
    """Save a specific displayed option, without assuming the first is cheapest."""
    priced = [(index, quote, quote_total(quote, "flight", trip))
              for index, quote in enumerate(list(flights)[:5], 1)]
    priced = [(index, quote, price) for index, quote, price in priced
              if price is not None and (trip.is_one_way or quote.get("return_flight"))
              if not quote.get("departure_code") or quote["departure_code"] == trip.origin
              if not quote.get("arrival_code") or quote["arrival_code"] == trip.destination]
    if not priced:
        return None
    valid = []
    for index, quote, price in priced:
        try:
            valid.append((index, quote_facts(quote, "flight", trip),
                          FlightItinerary.model_validate(quote), price))
        except ValidationError:
            continue
    if not valid:
        return None
    index, facts, itinerary, _ = min(valid, key=lambda item: (item[3], item[0]))
    return FlightRecommendation(
        searched_at=datetime.now(timezone.utc), trip=trip, flight=facts,
        itinerary=itinerary, option_number=index, priced_options_checked=len(valid),
    ).model_dump(mode="json")


def explain_flight_recommendation(saved):
    rec = FlightRecommendation.model_validate(saved)
    flight, trip = rec.flight, rec.trip
    outbound = rec.itinerary
    lines = [
        "**Why this flight?**",
        f"From the saved search on {rec.searched_at.strftime('%Y-%m-%d %H:%M UTC')}, "
        f"Option {rec.option_number} was the lowest complete USD fare among "
        f"{rec.priced_options_checked} priced displayed option(s).",
        "I interpreted 'this flight' as the lowest priced displayed option.",
        f"Route: {clean_text(trip.origin)} to {clean_text(trip.destination)}; "
        f"departure {clean_text(trip.start_date)}" +
        (f", return {clean_text(trip.end_date)}." if not trip.is_one_way else " (one-way)."),
        f"- Airline: {flight.name}; saved airfare: USD {flight.total_usd:.2f}.",
        f"- Outbound: {clean_text(outbound.departure_time)} to "
        f"{clean_text(outbound.arrival_time)}; {outbound.stops} stop(s).",
    ]
    if outbound.return_flight:
        returned = outbound.return_flight
        lines.append(f"- Return: {clean_text(returned.departure_time)} to "
                     f"{clean_text(returned.arrival_time)}; {returned.stops} stop(s).")
    lines.extend([
        "Only complete USD fares among the displayed options were ranked by airfare. "
        "Stops, timing, baggage and ground transport were not price-adjusted.",
        "This is a saved quote, not refreshed availability or a booking. "
        "Prices and fees can change before purchase.",
    ])
    return "\n\n".join(lines)


def explain_recommendation(saved):
    if not saved:
        return "I don't have a saved flight or full-trip recommendation in this chat yet. Ask me to search first, then ask why I chose an option."
    if not isinstance(saved, dict):
        return "I can't reliably read the saved recommendation. Please search again before asking me to explain it."
    if saved.get("version") == 3 and saved.get("kind") == "flight_only":
        try:
            return explain_flight_recommendation(saved)
        except (ValidationError, TypeError):
            return "I can't reliably read the saved flight quote. Please search again before asking me to explain it."
    try:
        rec = Recommendation.model_validate(saved)
    except ValidationError:
        return "I can't reliably read the saved recommendation. Please search again before asking me to explain it."
    trip = rec.trip
    stamp = rec.searched_at.strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "**Why this trip?**",
        f"Based on your saved search from {stamp}.",
        f"Route: {clean_text(trip.origin)} to {clean_text(trip.destination)}; flight dates {clean_text(trip.start_date)} to {clean_text(trip.end_date)}.",
        f"Hotel stay dates: {clean_text(getattr(trip, 'hotel_check_in_date', None) or trip.start_date)} to {clean_text(getattr(trip, 'hotel_check_out_date', None) or trip.end_date)}.",
        trip.label("full_trip"),
        f"- Flight: {rec.flight.name}.",
        f"- Hotel: {rec.hotel.name}.",
    ]
    flight, hotel = rec.flight.total_usd, rec.hotel.total_usd
    if flight is not None and hotel is not None:
        # Reuse Decimal-based price rules rather than model arithmetic.
        total = money(flight) + money(hotel)
        lines.append(f"- Saved price: USD {flight:.2f} flight fare + USD {hotel:.2f} full hotel stay = USD {total:.2f}.")
        if rec.timing_status == "compatible" and rec.accommodation_status == "matched":
            lines.append(f"- Selection: lowest combined price among {rec.combinations_checked} eligible returned combinations; this is not a guarantee of the cheapest trip everywhere.")
        else:
            lines.append(f"- Selection: lowest quoted total among {rec.combinations_checked} non-contradicted combinations; suitability remains provisional because some timing or lodging evidence is unverified.")
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
        (f"- Timing: {clean_text(rec.timing_message)}" if rec.timing_message else f"- Timing: the selected flight arrives at {rec.arrival_time}; timing needs confirmation because the saved quote predates this assessment."),
        (f"- Accommodation: {_accommodation_summary(rec.accommodation_status, rec.accommodation_reasons)}"),
        "Activities, meals, transfers and unquoted fees are excluded from the flight + hotel total.",
        "This explains a saved quote; prices and availability have not been refreshed. Ask me to search again for current quotes.",
    ])
    return "\n\n".join(lines)


def _accommodation_summary(status, reasons):
    explanations = {
        "room_privacy_unverified": "the provider did not specify whether the room is private",
        "property_type_unverified": "the provider did not specify the property category",
        "hotel_property_evidence": "the provider categorized the property as a hotel",
        "hostel_property_evidence": "the provider categorized the property as a hostel",
        "listing_name_suggests_hostel": "the listing name suggests a hostel",
        "private_room_evidence": "the provider identified a private room",
        "shared_room_evidence": "the provider identified a shared or dormitory room",
        "private_room_not_required": "a private room was not required",
    }
    details = [explanations[reason] for reason in reasons if reason in explanations]
    prefix = {"matched": "Requirements matched the available evidence.",
              "unknown": "Some lodging requirements remain unverified.",
              "contradicted": "The quote contradicted a lodging requirement."}.get(status, "Lodging evidence is unavailable.")
    return prefix + (" " + "; ".join(details) + "." if details else "")
