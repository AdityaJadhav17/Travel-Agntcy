# Copyright AGNTCY Contributors (https://github.com/agntcy)
# SPDX-License-Identifier: Apache-2.0

"""
Travel Logic Module

This module contains the business logic for finding optimal travel plans.
It handles timing constraints between flights and hotels, ensuring the traveler
has sufficient time to get from the airport to their hotel.

Key functions:
- extract_arrival_datetime: Parse flight arrival time into datetime
- filter_valid_hotels: Filter hotels that meet timing constraints
- find_cheapest_plan: Find the cheapest flight + hotel combination
"""

import logging
import math
from datetime import datetime, timedelta
from typing import Optional

from config.config import TRAVEL_HOTEL_CHECKIN_GAP_HOURS
from agents.travel.lodging import assess_accommodation, assess_timing

logger = logging.getLogger("lungo.travel.travel_logic")

# Hotel rating filter thresholds
# These ensure users get quality accommodations
MIN_OVERALL_RATING = 3.7  # Minimum overall hotel rating (1-5 scale)
MIN_LOCATION_RATING = 4.0  # Minimum location rating (1-5 scale)


def extract_arrival_datetime(flight: dict) -> Optional[datetime]:
    """
    Extract the arrival datetime from a flight's last leg.
    
    The arrival time represents when the traveler actually arrives at their
    destination, which is used to calculate if they can make hotel check-in.
    
    Supported time formats:
    - "YYYY-MM-DD HH:MM" (e.g., "2026-01-15 18:30")
    - "HH:MM" (time only, requires date inference from flight data)
    
    Args:
        flight: Flight dictionary containing arrival_time
    
    Returns:
        datetime object representing arrival time, or None if parsing fails
    
    Example:
        >>> flight = {"arrival_time": "2026-01-15 18:30"}
        >>> arrival = extract_arrival_datetime(flight)
        >>> print(arrival)  # datetime(2026, 1, 15, 18, 30)
    """
    arrival_time_str = flight.get("arrival_time", "")
    
    if not arrival_time_str:
        logger.warning("No arrival time found in flight data")
        return None
    
    # Try parsing various time formats
    formats_to_try = [
        "%Y-%m-%d %H:%M",     # Full datetime: "2026-01-15 18:30"
        "%Y-%m-%dT%H:%M",     # ISO format: "2026-01-15T18:30"
        "%Y-%m-%d %H:%M:%S",  # With seconds: "2026-01-15 18:30:00"
    ]
    
    for fmt in formats_to_try:
        try:
            return datetime.strptime(arrival_time_str, fmt)
        except ValueError:
            continue
    
    logger.warning(f"Could not parse arrival time: {arrival_time_str}")
    return None


def filter_valid_hotels(
    hotels: list[dict],
    flight_arrival: datetime,
    gap_hours: Optional[int] = None,
) -> list[dict]:
    """
    Filter hotels that allow check-in after the traveler arrives from their flight.
    
    This ensures the traveler has enough time (gap_hours) to:
    - Deplane and go through customs/immigration
    - Collect baggage
    - Travel from airport to hotel
    - Arrive at hotel in time for check-in
    
    Timing constraint:
        Hotels allow check-in ANYTIME AFTER their stated check-in time.
        So if check-in starts at 3 PM and traveler arrives at 5 PM + 2h gap = 7 PM,
        that's valid because 3 PM has already passed.
        
        Valid condition: hotel_check_in_time <= traveler_arrival_at_hotel
        AND traveler_arrival_at_hotel <= reasonable_cutoff (midnight)
    
    Args:
        hotels: List of hotel dictionaries with check_in_date and check_in_time
        flight_arrival: datetime when flight arrives at destination
        gap_hours: Minimum hours between flight arrival and hotel check-in.
                   Defaults to TRAVEL_HOTEL_CHECKIN_GAP_HOURS from config.
    
    Returns:
        List of hotels that meet the timing constraint
    
    Example:
        >>> flight_arrival = datetime(2026, 1, 15, 18, 30)  # 6:30 PM arrival
        >>> hotels = [{"check_in_time": "15:00", ...}, {"check_in_time": "20:00", ...}]
        >>> valid = filter_valid_hotels(hotels, flight_arrival, gap_hours=2)
        >>> # Hotel with 15:00 check-in is valid (traveler arrives at hotel ~8:30 PM, check-in started at 3 PM)
        >>> # Hotel with 20:00 check-in is valid (traveler arrives at hotel ~8:30 PM, check-in started at 8 PM)
    """
    if gap_hours is None:
        gap_hours = TRAVEL_HOTEL_CHECKIN_GAP_HOURS
    
    # Calculate when traveler actually arrives at hotel
    traveler_hotel_arrival = flight_arrival + timedelta(hours=gap_hours)
    
    # Reasonable cutoff - traveler should arrive at hotel before midnight
    midnight_cutoff = datetime.combine(flight_arrival.date(), datetime.strptime("23:59", "%H:%M").time())
    
    logger.info(
        f"Filtering hotels: flight arrives {flight_arrival.strftime('%Y-%m-%d %H:%M')}, "
        f"traveler reaches hotel by {traveler_hotel_arrival.strftime('%Y-%m-%d %H:%M')} (gap: {gap_hours}h)"
    )
    
    valid_hotels = []
    
    for hotel in hotels:
        hotel_checkin_datetime = _get_hotel_checkin_datetime(hotel, flight_arrival)
        
        if hotel_checkin_datetime is None:
            # If we can't determine check-in time, include it anyway (be permissive)
            logger.warning(f"Could not determine check-in time for hotel: {hotel.get('name')}, including anyway")
            valid_hotels.append(hotel)
            continue
        
        # Check-in timing rules:
        # 1. If traveler arrives on SAME DAY as check-in date:
        #    - Must arrive after check-in time (e.g., arrive 5 PM, check-in at 3 PM = OK)
        # 2. If traveler arrives AFTER check-in date (next day or later):
        #    - Can check in at any time (hotel holds the reservation)
        #    - Common for overnight/redeye flights
        # 3. Traveler should arrive within reasonable time (before 2 AM to avoid losing another night)
        
        arrival_date = traveler_hotel_arrival.date()
        checkin_date = hotel_checkin_datetime.date()
        
        # Case 1: Traveler arrives on check-in date (same day)
        same_day_arrival = arrival_date == checkin_date
        
        # Case 2: Traveler arrives after check-in date (next day - hotel holds reservation)
        # This is common for overnight flights that depart day 1 and arrive day 2
        next_day_arrival = arrival_date > checkin_date
        
        # For same-day arrival, check if check-in time has passed
        if same_day_arrival:
            # On check-in day: must arrive after check-in time (or wait until then)
            checkin_time_passed = traveler_hotel_arrival.time() >= hotel_checkin_datetime.time()
            is_valid = checkin_time_passed or traveler_hotel_arrival <= midnight_cutoff
        elif next_day_arrival:
            # After check-in date: hotel holds reservation, can check in anytime
            # Just make sure it's not too many days late (within 1 day is reasonable)
            days_late = (arrival_date - checkin_date).days
            is_valid = days_late <= 1  # Allow up to 1 day late arrival
        else:
            # Arriving before check-in date - not valid
            is_valid = False
        
        if is_valid:
            valid_hotels.append(hotel)
            logger.debug(
                f"Hotel '{hotel.get('name')}' is valid "
                f"(check-in: {checkin_date} {hotel_checkin_datetime.time()}, "
                f"arrival: {arrival_date} {traveler_hotel_arrival.time()})"
            )
        else:
            logger.debug(
                f"Hotel '{hotel.get('name')}' excluded - "
                f"check-in: {checkin_date} {hotel_checkin_datetime.time()}, "
                f"arrival: {arrival_date} {traveler_hotel_arrival.time()}"
            )
    
    logger.info(f"Filtered {len(valid_hotels)} valid hotels from {len(hotels)} total")
    return valid_hotels


def filter_hotels_by_rating(
    hotels: list[dict],
    min_overall_rating: float = MIN_OVERALL_RATING,
    min_location_rating: float = MIN_LOCATION_RATING,
) -> list[dict]:
    """
    Filter hotels by minimum overall and location ratings.
    
    This ensures users get quality accommodations with good ratings.
    Hotels must meet BOTH rating thresholds to be included.
    
    Args:
        hotels: List of hotel dictionaries with rating info
        min_overall_rating: Minimum overall rating required (default: 3.7)
        min_location_rating: Minimum location rating required (default: 4.0)
    
    Returns:
        List of hotels that meet both rating thresholds
    
    Example:
        >>> hotels = [{"overall_rating": 4.2, "location_rating": 4.5, ...}, ...]
        >>> quality_hotels = filter_hotels_by_rating(hotels, min_overall=3.7, min_location=4.0)
    """
    logger.info(
        f"Filtering hotels by rating: min_overall={min_overall_rating}, "
        f"min_location={min_location_rating}"
    )
    
    valid_hotels = []
    
    for hotel in hotels:
        # Get overall rating - check multiple possible field names
        overall_rating = hotel.get("overall_rating", 0) or hotel.get("rating", 0) or 0
        location_rating = hotel.get("location_rating", 0) or 0
        
        # Check overall rating threshold - REQUIRED
        meets_overall = overall_rating >= min_overall_rating
        
        # Check location rating threshold - OPTIONAL if not available
        # If location_rating is 0 (not available), skip location requirement
        # Only apply location filter if we actually have location data
        if location_rating > 0:
            # Location rating is available - apply the filter
            meets_location = location_rating >= min_location_rating
        else:
            # No location rating available - skip this requirement
            # User's preference for location rating applies only when data exists
            meets_location = True  # Don't penalize hotels without location data
        
        if meets_overall and meets_location:
            valid_hotels.append(hotel)
            logger.debug(
                f"Hotel '{hotel.get('name')}' meets rating criteria "
                f"(overall: {overall_rating}, location: {location_rating if location_rating > 0 else 'N/A'})"
            )
        else:
            logger.debug(
                f"Hotel '{hotel.get('name')}' excluded - "
                f"overall: {overall_rating} (min: {min_overall_rating}), "
                f"location: {location_rating if location_rating > 0 else 'N/A'} (min: {min_location_rating})"
            )
    
    logger.info(f"Filtered {len(valid_hotels)} quality hotels from {len(hotels)} total")
    return valid_hotels


def _get_hotel_checkin_datetime(hotel: dict, reference_date: datetime) -> Optional[datetime]:
    """
    Convert hotel check-in date and time into a datetime object.
    
    If check_in_date is provided, use it. Otherwise, use the reference_date
    (typically the flight arrival date) as the check-in date.
    
    Default check-in time is 15:00 (3 PM) if not specified.
    
    Args:
        hotel: Hotel dictionary with check_in_date and check_in_time
        reference_date: Date to use if hotel check_in_date is not available
    
    Returns:
        datetime for hotel check-in, or None if parsing fails
    """
    # Get check-in date - use hotel's date or flight arrival date
    check_in_date_str = hotel.get("check_in_date", "")
    
    if check_in_date_str:
        try:
            check_in_date = datetime.strptime(check_in_date_str, "%Y-%m-%d").date()
        except ValueError:
            check_in_date = reference_date.date()
    else:
        check_in_date = reference_date.date()
    
    # Get check-in time - default to 15:00 (3 PM) if not specified
    check_in_time_str = hotel.get("check_in_time", "15:00")
    
    try:
        # Parse time string (e.g., "15:00" or "3:00 PM")
        if "PM" in check_in_time_str.upper() or "AM" in check_in_time_str.upper():
            check_in_time = datetime.strptime(check_in_time_str, "%I:%M %p").time()
        else:
            check_in_time = datetime.strptime(check_in_time_str, "%H:%M").time()
    except ValueError:
        # Default to 3 PM if parsing fails
        check_in_time = datetime.strptime("15:00", "%H:%M").time()
    
    # Combine date and time
    return datetime.combine(check_in_date, check_in_time)


def find_cheapest_plan(
    flights: list[dict],
    hotels: list[dict],
    gap_hours: Optional[int] = None,
    min_overall_rating: float = MIN_OVERALL_RATING,
    min_location_rating: float = MIN_LOCATION_RATING,
    *,
    check_in_date: str | None = None,
    check_out_date: str | None = None,
    accommodation_type: str | None = None,
    private_room_required: bool | None = None,
) -> Optional[dict]:
    """Choose the lowest priced non-contradicted pair, preferring confirmed timing.

    Uncertain timing remains a provisional result with explicit reasons. Known
    incompatible arrivals and contradicted accommodation are never selected.
    """
    if not flights or not hotels:
        return None
    gap = TRAVEL_HOTEL_CHECKIN_GAP_HOURS if gap_hours is None else gap_hours
    accommodation = {
        id(h): assess_accommodation(h, accommodation_type, private_room_required)
        for h in hotels
    }
    eligible_hotels = [h for h in hotels if accommodation[id(h)]["status"] != "contradicted"]
    if not eligible_hotels:
        return None
    quality = filter_hotels_by_rating(eligible_hotels, min_overall_rating, min_location_rating)
    rating_policy = "standard"
    if not quality:
        rating_policy = "location_relaxed"
        quality = filter_hotels_by_rating(eligible_hotels, min_overall_rating, 0)
    if not quality:
        rating_policy = "overall_relaxed"
        quality = [h for h in eligible_hotels if (h.get("overall_rating", 0) or h.get("rating", 0) or 0) >= 3.0]
    if not quality:
        rating_policy, quality = "unfiltered", eligible_hotels

    candidates = []
    for flight in flights:
        arrival = extract_arrival_datetime(flight)
        for hotel in quality:
            lodging = accommodation[id(hotel)]
            ci = check_in_date or hotel.get("check_in_date")
            co = check_out_date or hotel.get("check_out_date")
            timing = assess_timing(flight, hotel, ci, co, gap)
            if timing["timing_status"] == "incompatible":
                continue
            # Quote may omit dates if legacy callers did not pass them. In that
            # case use the quote's stay metadata and retain the assessment's
            # needs-confirmation status if those dates are also absent.
            flight_price = _valid_quote_price(flight.get("price"))
            hotel_price = _hotel_stay_price(hotel, ci, co)
            if flight_price is None or hotel_price is None:
                continue
            total = flight_price + hotel_price
            status_rank = 0 if timing["timing_status"] == "compatible" else 1
            lodging_rank = 0 if lodging["status"] == "matched" else 1
            candidates.append((status_rank, lodging_rank, total, flight, hotel, timing, lodging, arrival))
    if not candidates:
        return None
    _, _, total, flight, hotel, timing, lodging, arrival = min(candidates, key=lambda x: (x[0], x[1], x[2]))
    arrival_text = arrival.strftime("%Y-%m-%d %H:%M") if arrival else ""
    selected_hotel = dict(hotel)
    selected_hotel.update({
        "accommodation_evidence": lodging["evidence"],
        "accommodation_status": lodging["status"],
        "accommodation_reasons": lodging["reasons"],
        "timing_status": timing["timing_status"],
        "timing_reason_codes": timing["timing_reason_codes"],
        "timing_message": timing["timing_message"],
        "arrival_at_hotel": timing["arrival_at_hotel"],
        "check_in_date": check_in_date or timing["check_in_date"] or hotel.get("check_in_date"),
        "check_out_date": check_out_date or timing["check_out_date"] or hotel.get("check_out_date"),
        "provisional": timing["timing_status"] != "compatible" or lodging["status"] == "unknown",
    })
    return {
        "flight": flight, "hotel": selected_hotel, "total_price": total, "gap_hours": gap,
        "arrival_time": arrival_text,
        "timing_status": timing["timing_status"],
        "timing_assessment": timing,
        "accommodation_status": lodging["status"],
        "accommodation_assessment": lodging,
        "provisional": timing["timing_status"] != "compatible" or lodging["status"] == "unknown",
        "selection": {
            "rating_policy": rating_policy, "combinations_checked": len(candidates),
            "min_overall_rating": min_overall_rating, "min_location_rating": min_location_rating,
        },
    }


def _valid_quote_price(value):
    if isinstance(value, bool):
        return None
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return None
    return amount if amount > 0 and math.isfinite(amount) else None


def _hotel_stay_price(hotel, check_in, check_out):
    """Return a full-stay quote; never treat a nightly rate as the stay total."""
    if hotel.get("total_price") is not None:
        return _valid_quote_price(hotel.get("total_price"))
    nightly = _valid_quote_price(hotel.get("price"))
    if nightly is None:
        return None
    try:
        nights = (datetime.strptime(str(check_out)[:10], "%Y-%m-%d").date()
                  - datetime.strptime(str(check_in)[:10], "%Y-%m-%d").date()).days
    except (TypeError, ValueError):
        return None
    return nightly * nights if nights > 0 else None
