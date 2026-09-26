"""Bounded flight facts retained only while a failed hotel search can be retried."""

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

from .budgets import quote_total
from .models import TravelSearchArgs
from .recommendations import FlightItinerary, quote_facts


class RetainedFlight(BaseModel):
    id: str = Field(max_length=40)
    itinerary: FlightItinerary


class PartialSearch(BaseModel):
    version: Literal[1] = 1
    trip: TravelSearchArgs
    hotel_checkout_date: str = Field(max_length=32)
    searched_at: datetime
    flights: list[RetainedFlight] = Field(min_length=1, max_length=5)
    attempts: int = Field(default=0, ge=0, le=2)
    reason: Literal["error", "empty"]


def retain_flights(flights, trip: TravelSearchArgs, hotel_checkout_date: str, reason: str, attempts=0):
    """Keep only complete USD quotes with the itinerary needed for exact retry."""
    retained = []
    for flight in flights:
        if quote_total(flight, "flight", trip) is None:
            continue
        try:
            retained.append(RetainedFlight(
                id=quote_facts(flight, "flight", trip).id,
                itinerary=FlightItinerary.model_validate(flight),
            ))
        except ValidationError:
            continue
        if len(retained) == 5:
            break
    if not retained or attempts >= 2:
        return None
    return PartialSearch(
        trip=trip, hotel_checkout_date=hotel_checkout_date,
        searched_at=datetime.now(timezone.utc), flights=retained,
        attempts=attempts, reason=reason,
    ).model_dump(mode="json")
