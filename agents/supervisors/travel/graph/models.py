# Copyright AGNTCY Contributors (https://github.com/agntcy)
# SPDX-License-Identifier: Apache-2.0

"""
Travel Supervisor Models

Pydantic models for structured data extraction and validation.
These models are used with LLM structured output to ensure
proper parsing of user travel requests.
"""

from pydantic import BaseModel, Field
from typing import Optional, Literal
from agents.travel.party import TravelParty


class TravelSearchArgs(TravelParty):
    """
    Arguments extracted from user input for travel search.
    
    Used with LLM structured output to parse natural language
    trip requests into structured parameters.
    
    Supports multiple search types:
    - full_trip: Flight + Hotel + Activities (default)
    - flight_only: Just flights (one-way or round-trip)
    - hotel_only: Just hotels at a location
    - activity_only: Just activities/things to do at a location
    
    Attributes:
        search_type: Type of search - "full_trip", "flight_only", "hotel_only", "activity_only"
        origin: Departure airport code (e.g., "LAX", "JFK") - for flights
        destination: Arrival airport code (e.g., "NRT", "CDG") - for flights
        origin_city: Original departure city name - for display
        destination_city: Original arrival city name - for hotels/activities
        location: General location for hotel-only or activity-only searches
        start_date: Trip start date in YYYY-MM-DD format
        end_date: Trip end/return date in YYYY-MM-DD format
        is_one_way: True if user wants one-way flight only
        has_all_params: Whether all required parameters were extracted
        missing_params: Description of any missing parameters
    
    Examples:
        Full trip: "Find trip from LAX to Tokyo, Jan 15-22"
        Flight only: "Find flights from Seattle to San Diego on Feb 20"
        Hotel only: "Find hotels in Paris for March 1-5"
        Activity only: "What things to do in San Francisco?"
    """
    budget_amount: Optional[float] = Field(default=None, gt=0, allow_inf_nan=False, description="Positive budget limit; preserve across follow-ups, null when explicitly removed")
    budget_currency: Optional[str] = Field(default=None, pattern=r"^[A-Z]{3}$", description="Explicit ISO currency code, e.g. USD; null if ambiguous")
    budget_scope: Optional[Literal["quoted_total", "per_night", "per_person", "all_in"]] = Field(default=None, description="quoted_total means the current search's flight fare and/or full hotel stay; do not assume scope when unclear")
    clarification_question: str = Field(default="", description="A short question for ambiguous input; empty when unambiguous")
    search_type: Literal["full_trip", "flight_only", "hotel_only", "activity_only"] = Field(
        default="full_trip",
        description="Type of search: 'full_trip' (flight+hotel+activities), 'flight_only', 'hotel_only', 'activity_only'"
    )
    origin: Optional[str] = Field(
        default=None,
        description="Departure airport code (e.g., 'LAX', 'JFK') - converted from city name"
    )
    destination: Optional[str] = Field(
        default=None,
        description="Arrival airport code (e.g., 'NRT', 'CDG') - converted from city name"
    )
    origin_city: Optional[str] = Field(
        default=None,
        description="Original departure city name before airport code conversion (e.g., 'New York', 'Los Angeles')"
    )
    destination_city: Optional[str] = Field(
        default=None,
        description="Original arrival city name before airport code conversion (e.g., 'Tokyo', 'Paris') - used for hotel searches"
    )
    location: Optional[str] = Field(
        default=None,
        description="General location for hotel-only or activity-only searches (e.g., 'Paris', 'San Francisco')"
    )
    start_date: Optional[str] = Field(
        default=None,
        description="Trip start/departure date in YYYY-MM-DD format"
    )
    end_date: Optional[str] = Field(
        default=None,
        description="Trip end/return date in YYYY-MM-DD format (optional for one-way trips)"
    )
    is_one_way: bool = Field(
        default=False,
        description="True if user wants one-way flight only (no return date needed)"
    )
    has_all_params: bool = Field(
        default=False,
        description="True if all required parameters were extracted based on search_type"
    )
    missing_params: str = Field(
        default="",
        description="Comma-separated list of missing parameters, if any"
    )


class TravelPlan(BaseModel):
    """
    Represents a complete travel plan with flight and hotel details.
    
    Used to structure the response returned to the user after
    finding the optimal flight + hotel combination.
    
    Attributes:
        flight_price: Cost of the flight in USD
        flight_airline: Airline operating the flight
        flight_departure: Departure datetime string
        flight_arrival: Arrival datetime string
        flight_stops: Number of layovers/stops
        hotel_name: Name of the selected hotel
        hotel_price: Cost of the hotel stay in USD
        hotel_rating: Hotel star rating
        total_price: Combined flight + hotel cost
        check_in_gap_hours: Hours between flight arrival and hotel check-in
    """
    flight_price: float = Field(description="Flight price in USD")
    flight_airline: str = Field(description="Airline name")
    flight_departure: str = Field(description="Departure datetime")
    flight_arrival: str = Field(description="Arrival datetime")
    flight_stops: int = Field(description="Number of stops/layovers")
    hotel_name: str = Field(description="Hotel name")
    hotel_price: float = Field(description="Hotel price in USD")
    hotel_rating: float = Field(default=0, description="Hotel rating")
    total_price: float = Field(description="Total trip cost in USD")
    check_in_gap_hours: int = Field(description="Gap between arrival and check-in")
