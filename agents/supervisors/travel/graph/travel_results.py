"""Versioned, bounded display facts for travel cards.

These facts come from provider results after search and budget filtering. The
human-readable response remains available to older clients.
"""

import hashlib
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from .budgets import money, quote_total
from .models import TravelSearchArgs
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


class HotelCard(BaseModel):
    id: str
    name: str = Field(max_length=160)
    nightly_usd: float | None = Field(ge=0, allow_inf_nan=False)
    total_usd: float | None = Field(ge=0, allow_inf_nan=False)
    overall_rating: float | None = Field(default=None, ge=0, le=5, allow_inf_nan=False)
    location_rating: float | None = Field(default=None, ge=0, le=5, allow_inf_nan=False)


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


class TravelResult(BaseModel):
    version: Literal[1] = 1
    kind: Literal["full_trip", "flight_only", "hotel_only", "activity_only", "airport_comparison"]
    searched_at: datetime
    origin: str = Field(default="", max_length=160)
    destination: str = Field(default="", max_length=160)
    start_date: str = Field(default="", max_length=32)
    end_date: str = Field(default="", max_length=32)
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


def _hotel(quote, trip):
    nightly = money(quote.get("price")) if quote.get("currency") == "USD" else None
    total = quote_total(quote, "hotel", trip)
    return HotelCard(
        id=quote_facts(quote, "hotel", trip).id,
        name=clean_text(quote.get("name")),
        nightly_usd=float(nightly) if nightly is not None else None,
        total_usd=float(total) if total is not None else None,
        overall_rating=_rating(quote.get("overall_rating") or quote.get("rating")),
        location_rating=_rating(quote.get("location_rating")),
    )


def _activity(quote):
    name = clean_text(quote.get("name"))
    digest = hashlib.sha256(name.encode()).hexdigest()[:24]
    return ActivityCard(
        id=f"activity-{digest}", name=name,
        type=clean_text(quote.get("type")), rating=_rating(quote.get("rating")),
    )


def travel_result(kind, trip: TravelSearchArgs, *, flights=(), hotels=(), activities=(),
                  hotel_checkout_date=None, notice=""):
    """Return a JSON-ready card result, without guessing absent USD prices."""
    flight_cards = [_flight(q, trip) for q in list(flights)[:5]]
    hotel_trip = trip.model_copy(update={"end_date": hotel_checkout_date}) if hotel_checkout_date else trip
    hotel_cards = [_hotel(q, hotel_trip) for q in list(hotels)[:5]]
    activity_cards = [_activity(q) for q in list(activities)[:5]]
    total = None
    if kind == "full_trip" and flight_cards[0].total_usd is not None and hotel_cards[0].total_usd is not None:
        total = float(money(flight_cards[0].total_usd + hotel_cards[0].total_usd))
    return TravelResult(
        kind=kind, searched_at=datetime.now(timezone.utc),
        origin=clean_text(trip.origin) if trip.origin else "",
        destination=clean_text(trip.location or trip.destination_city or trip.destination)
        if (trip.location or trip.destination_city or trip.destination) else "",
        start_date=trip.start_date or "", end_date=hotel_checkout_date or trip.end_date or "",
        adults=trip.adults, children=trip.children, rooms=trip.rooms, is_one_way=trip.is_one_way,
        flights=flight_cards, hotels=hotel_cards, activities=activity_cards,
        total_usd=total, notice=clean_text(notice) if notice else "",
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
