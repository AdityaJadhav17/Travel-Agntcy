"""Versioned, bounded display facts for travel cards.

These facts come from provider results after search and budget filtering. The
human-readable response remains available to older clients.
"""

import hashlib
import re
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from .budgets import money, quote_total
from .models import TravelSearchArgs
from .presentation_selection import select_for_presentation
from .recommendations import clean_text, quote_facts


class ReturnFlightCard(BaseModel):
    airline: str = Field(max_length=160)
    departure_time: str = Field(max_length=160)
    arrival_time: str = Field(max_length=160)
    stops: int = Field(ge=0)


class FlightCard(BaseModel):
    id: str
    airline: str = Field(max_length=160)
    total_usd: float | None = Field(ge=0, allow_inf_nan=False)
    departure_time: str = Field(max_length=160)
    arrival_time: str = Field(max_length=160)
    stops: int = Field(ge=0)
    return_flight: ReturnFlightCard | None = None


class AccommodationEvidenceCard(BaseModel):
    property_type: str | None = Field(default=None, max_length=80)
    room_type: str | None = Field(default=None, max_length=80)
    source: str | None = Field(default=None, max_length=80)


class HotelCard(BaseModel):
    id: str
    name: str = Field(max_length=160)
    nightly_usd: float | None = Field(ge=0, allow_inf_nan=False)
    total_usd: float | None = Field(ge=0, allow_inf_nan=False)
    overall_rating: float | None = Field(default=None, ge=0, le=5, allow_inf_nan=False)
    location_rating: float | None = Field(default=None, ge=0, le=5, allow_inf_nan=False)
    # Optional evidence is additive so persisted cards from older searches remain valid.
    property_type: str | None = Field(default=None, max_length=80)
    room_type: str | None = Field(default=None, max_length=80)
    accommodation_evidence_source: str | None = Field(default=None, max_length=80)
    accommodation_status: Literal["matched", "contradicted", "unknown"] = "unknown"
    accommodation_reasons: list[str] = Field(default_factory=list, max_length=5)
    accommodation_evidence: AccommodationEvidenceCard | None = None
    check_in_date: str | None = Field(default=None, max_length=10)
    check_out_date: str | None = Field(default=None, max_length=10)
    timing_status: Literal["compatible", "incompatible", "needs_confirmation"] | None = None
    timing_reason_codes: list[str] = Field(default_factory=list, max_length=8)
    timing_message: str = Field(default="", max_length=240)
    arrival_at_hotel: str | None = Field(default=None, max_length=80)
    provisional: bool = False


class ActivityCard(BaseModel):
    id: str
    name: str = Field(max_length=160)
    type: str = Field(max_length=160)
    rating: float | None = Field(default=None, ge=0, le=5, allow_inf_nan=False)


class AirportAlternativeCard(BaseModel):
    arrival_airport: str = Field(min_length=3, max_length=3)
    airport_name: str = Field(max_length=160)
    municipality: str = Field(max_length=160)
    straight_line_miles: int = Field(ge=0, le=2000)
    driving_miles: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    driving_minutes: int | None = Field(default=None, ge=0)
    fare_usd: float = Field(ge=0, allow_inf_nan=False)
    savings_usd: float | None = Field(default=None, allow_inf_nan=False)
    flight: FlightCard


class DateAlternativeCard(BaseModel):
    departure_date: str = Field(min_length=10, max_length=10)
    return_date: str = Field(default="", max_length=10)
    fare_usd: float = Field(gt=0, allow_inf_nan=False)
    savings_usd: float | None = Field(default=None, allow_inf_nan=False)
    flight: FlightCard


class TravelResult(BaseModel):
    version: Literal[1] = 1
    kind: Literal["full_trip", "flight_only", "hotel_only", "activity_only", "airport_comparison", "date_comparison"]
    searched_at: datetime
    origin: str = Field(default="", max_length=160)
    destination: str = Field(default="", max_length=160)
    start_date: str = Field(default="", max_length=32)
    end_date: str = Field(default="", max_length=32)
    hotel_check_in_date: str | None = Field(default=None, max_length=10)
    hotel_check_out_date: str | None = Field(default=None, max_length=10)
    flight_result_count: int | None = Field(default=None, ge=1, le=100)
    hotel_result_count: int | None = Field(default=None, ge=1, le=100)
    activity_result_count: int | None = Field(default=None, ge=1, le=100)
    adults: int = Field(ge=1, le=9)
    children: int = Field(ge=0, le=8)
    rooms: int = Field(ge=1, le=9)
    is_one_way: bool
    flights: list[FlightCard] = Field(default_factory=list, max_length=5)
    hotels: list[HotelCard] = Field(default_factory=list, max_length=5)
    activities: list[ActivityCard] = Field(default_factory=list, max_length=5)
    requested_airport: str = Field(default="", max_length=3)
    requested_fare_usd: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    airport_alternatives: list[AirportAlternativeCard] = Field(default_factory=list, max_length=7)
    base_fare_usd: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    date_alternatives: list[DateAlternativeCard] = Field(default_factory=list, max_length=7)
    total_usd: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    notice: str = Field(default="", max_length=240)

    @model_validator(mode="after")
    def require_results(self):
        required = {
            "full_trip": (self.flights, self.hotels),
            "flight_only": (self.flights,),
            "hotel_only": (self.hotels,),
            "activity_only": (self.activities,),
            "airport_comparison": (self.airport_alternatives,),
            "date_comparison": (self.date_alternatives,),
        }[self.kind]
        if not all(required):
            raise ValueError("A successful result needs its searched options")
        return self


def _rating(value):
    try:
        number = float(value)
        return number if 0 < number <= 5 else None
    except (TypeError, ValueError, OverflowError):
        return None


def _stops(value):
    try:
        return max(0, min(10, int(value)))
    except (TypeError, ValueError, OverflowError):
        return 0


def _flight(quote, trip):
    returned = quote.get("return_flight")
    return FlightCard(
        id=quote_facts(quote, "flight", trip).id,
        airline=clean_text(quote.get("airline")),
        total_usd=float(total) if (total := quote_total(quote, "flight", trip)) is not None else None,
        departure_time=clean_text(quote.get("departure_time")),
        arrival_time=clean_text(quote.get("arrival_time")),
        stops=_stops(quote.get("stops")),
        return_flight=ReturnFlightCard(
            airline=clean_text(returned.get("airline")),
            departure_time=clean_text(returned.get("departure_time")),
            arrival_time=clean_text(returned.get("arrival_time")),
            stops=_stops(returned.get("stops")),
        ) if isinstance(returned, dict) else None,
    )


def _optional_text(value, limit=80):
    value = clean_text(value) if value is not None else ""
    if value == "Not supplied":
        return None
    return value[:limit] or None


_SAFE_CODE = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,79}\Z")


def _safe_code(value):
    """Keep machine identifiers intact while rejecting arbitrary provider prose."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value if _SAFE_CODE.fullmatch(value) else None


def _hotel(quote, trip, check_in=None, check_out=None):
    nightly = money(quote.get("price")) if quote.get("currency") == "USD" else None
    total = quote_total(quote, "hotel", trip)
    evidence = quote.get("accommodation_evidence")
    evidence = evidence if isinstance(evidence, dict) else {}
    return HotelCard(
        id=quote_facts(quote, "hotel", trip).id,
        name=clean_text(quote.get("name")),
        nightly_usd=float(nightly) if nightly is not None else None,
        total_usd=float(total) if total is not None else None,
        overall_rating=_rating(quote.get("overall_rating") or quote.get("rating")),
        location_rating=_rating(quote.get("location_rating")),
        property_type=_optional_text(quote.get("property_type") or evidence.get("property_type")),
        room_type=_optional_text(quote.get("room_type") or evidence.get("room_type")),
        accommodation_evidence_source=_safe_code(quote.get("accommodation_evidence_source") or evidence.get("source")),
        accommodation_status=quote.get("accommodation_status", "unknown"),
        accommodation_reasons=[code for item in quote.get("accommodation_reasons", [])[:5]
                               if (code := _safe_code(item))]
        if isinstance(quote.get("accommodation_reasons", []), list) else [],
        accommodation_evidence={
            "property_type": _optional_text(quote.get("property_type") or evidence.get("property_type")),
            "room_type": _optional_text(quote.get("room_type") or evidence.get("room_type")),
            "source": _safe_code(quote.get("accommodation_evidence_source") or evidence.get("source")),
        } if evidence or quote.get("property_type") or quote.get("room_type") else None,
        check_in_date=_optional_text(quote.get("check_in_date") or check_in, 10),
        check_out_date=_optional_text(quote.get("check_out_date") or check_out, 10),
        timing_status=quote.get("timing_status"),
        timing_reason_codes=[code for item in quote.get("timing_reason_codes", [])[:8]
                             if (code := _safe_code(item))]
        if isinstance(quote.get("timing_reason_codes", []), list) else [],
        timing_message=clean_text(quote.get("timing_message"))[:240] if quote.get("timing_message") else "",
        arrival_at_hotel=_optional_text(quote.get("arrival_at_hotel")),
        provisional=quote.get("provisional") is True,
    )


def _activity(quote):
    name = clean_text(quote.get("name"))
    digest = hashlib.sha256(name.encode()).hexdigest()[:24]
    return ActivityCard(
        id=f"activity-{digest}", name=name,
        type=clean_text(quote.get("type")), rating=_rating(quote.get("rating")),
    )


def travel_result(kind, trip: TravelSearchArgs, *, flights=(), hotels=(), activities=(),
                  hotel_checkout_date=None, hotel_check_in_date=None,
                  hotel_check_out_date=None, notice="", combine_quotes=True):
    """Return a JSON-ready card result, without guessing absent USD prices."""
    flight_counts = getattr(trip, "flight_result_count", None)
    hotel_counts = getattr(trip, "hotel_result_count", None)
    activity_counts = getattr(trip, "activity_result_count", None)
    flight_pool, hotel_pool, activity_pool = list(flights), list(hotels), list(activities)
    if kind == "full_trip" and combine_quotes:
        selected_flights, flight_notice = flight_pool[:1], ""
        selected_hotels, hotel_notice = hotel_pool[:1], ""
    else:
        selected_flights, flight_notice = (select_for_presentation(flight_pool, flight_counts)
                                           if kind in ("flight_only", "full_trip") else ([], ""))
        selected_hotels, hotel_notice = (select_for_presentation(hotel_pool, hotel_counts)
                                         if kind in ("hotel_only", "full_trip") else ([], ""))
    selected_activities, activity_notice = (select_for_presentation(activity_pool, activity_counts)
                                            if kind in ("full_trip", "activity_only") and activity_pool else ([], ""))
    flight_cards = [_flight(q, trip) for q in selected_flights]
    check_in = hotel_check_in_date or getattr(trip, "hotel_check_in_date", None)
    check_out = hotel_check_out_date or hotel_checkout_date or getattr(trip, "hotel_check_out_date", None)
    # Keep quote identity based on the user's persisted trip. The display dates
    # may fall back to flight dates, but synthesizing them into the trip here
    # would make a default-date card ID differ from its saved recommendation.
    hotel_cards = [_hotel(q, trip, check_in, check_out) for q in selected_hotels]
    activity_cards = [_activity(q) for q in selected_activities]
    total = None
    if (kind == "full_trip" and combine_quotes and flight_cards[0].total_usd is not None
            and hotel_cards[0].total_usd is not None):
        total = float(money(flight_cards[0].total_usd + hotel_cards[0].total_usd))
    notices = [clean_text(item) for item in (
        notice,
        "Separate quotes; no compatible pairing was confirmed." if kind == "full_trip" and not combine_quotes else "",
        flight_notice, hotel_notice, activity_notice,
    ) if item]
    return TravelResult(
        kind=kind, searched_at=datetime.now(timezone.utc),
        origin=clean_text(trip.origin) if trip.origin else "",
        destination=clean_text(trip.location or trip.destination_city or trip.destination)
        if (trip.location or trip.destination_city or trip.destination) else "",
        start_date=trip.start_date or "", end_date=trip.end_date or check_out or "",
        hotel_check_in_date=check_in, hotel_check_out_date=check_out,
        flight_result_count=flight_counts, hotel_result_count=hotel_counts,
        activity_result_count=activity_counts,
        adults=trip.adults, children=trip.children, rooms=trip.rooms, is_one_way=trip.is_one_way,
        flights=flight_cards, hotels=hotel_cards, activities=activity_cards,
        total_usd=total, notice=" ".join(notices)[:240],
    ).model_dump(mode="json")


def airport_comparison_result(trip: TravelSearchArgs, target, quoted):
    """Present only provider-priced, same-party itineraries for each arrival airport."""
    baseline = next((float(price) for arrival, _, price, _ in quoted
                     if arrival.airport.code == target.code), None)
    alternatives = []
    for arrival, quote, price, route in quoted:
        airport = arrival.airport
        airport_trip = trip.model_copy(update={"destination": airport.code})
        alternatives.append(AirportAlternativeCard(
            arrival_airport=airport.code,
            airport_name=clean_text(airport.name), municipality=clean_text(airport.municipality),
            straight_line_miles=arrival.straight_line_miles,
            driving_miles=route["miles"] if route else None,
            driving_minutes=route["minutes"] if route else None,
            fare_usd=float(price),
            savings_usd=round(baseline - float(price), 2) if baseline is not None else None,
            flight=_flight(quote, airport_trip),
        ))
    alternatives.sort(key=lambda option: (option.fare_usd, option.straight_line_miles))
    notice = ("Fares cover the requested travelers. Driving estimates end in the destination city; "
              "straight-line miles end at the requested airport. Ground-transfer cost is unknown "
              "and excluded, so lower airfare may not mean a cheaper journey.")
    return TravelResult(
        kind="airport_comparison", searched_at=datetime.now(timezone.utc),
        origin=clean_text(trip.origin), destination=clean_text(trip.destination_city or target.municipality or target.code),
        start_date=trip.start_date or "", end_date=trip.end_date or "",
        adults=trip.adults, children=trip.children, rooms=trip.rooms, is_one_way=trip.is_one_way,
        requested_airport=target.code, requested_fare_usd=baseline,
        airport_alternatives=alternatives, notice=notice,
    ).model_dump(mode="json")


def date_comparison_result(trip: TravelSearchArgs, quoted):
    """Show verified fares for shifted dates, with a fresh baseline when found."""
    baseline = next((float(price) for departure, _, _, price in quoted
                     if departure == trip.start_date), None)
    alternatives = []
    for departure, returned, quote, price in quoted:
        option_trip = trip.model_copy(update={"start_date": departure, "end_date": returned})
        alternatives.append(DateAlternativeCard(
            departure_date=departure, return_date=returned or "",
            fare_usd=float(price),
            savings_usd=round(baseline - float(price), 2) if baseline is not None else None,
            flight=_flight(quote, option_trip),
        ))
    alternatives.sort(key=lambda option: (option.fare_usd, option.departure_date))
    notice = ("Airfare only for the requested travelers. Round-trip options shift departure "
              "and return together, keeping the same trip length. Hotel, activities, "
              "baggage and transfers are not repriced. Confirm fares before booking.")
    return TravelResult(
        kind="date_comparison", searched_at=datetime.now(timezone.utc),
        origin=clean_text(trip.origin), destination=clean_text(trip.destination_city or trip.destination),
        start_date=trip.start_date or "", end_date=trip.end_date or "",
        adults=trip.adults, children=trip.children, rooms=trip.rooms, is_one_way=trip.is_one_way,
        base_fare_usd=baseline, date_alternatives=alternatives, notice=notice,
    ).model_dump(mode="json")
