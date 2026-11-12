from agents.travel.lodging import assess_accommodation, assess_timing
from agents.travel.serpapi_tools import _parse_hotel
from agents.travel.travel_logic import find_cheapest_plan


def test_accommodation_requires_real_room_evidence_and_shared_dominates():
    assert assess_accommodation({"name": "Hotel One"}, "hotel")["status"] == "unknown"
    assert assess_accommodation({"name": "Hotel One", "property_type": "Hotel", "accommodation_evidence_source": "provider"}, "hotel")["status"] == "matched"
    assert assess_accommodation({"name": "Hostel One"}, "hotel")["status"] == "contradicted"
    assert assess_accommodation({"room_type": "private bathroom in shared dorm", "accommodation_evidence_source": "provider"}, private_room_required=True)["status"] == "contradicted"
    assert assess_accommodation({"room_type": "not a private room", "accommodation_evidence_source": "provider"}, private_room_required=True)["status"] == "contradicted"
    assert assess_accommodation({"room_type": "non-private room", "accommodation_evidence_source": "provider"}, private_room_required=True)["status"] == "contradicted"
    assert assess_accommodation({"room_type": "Private room", "accommodation_evidence_source": "provider"}, private_room_required=True)["status"] == "matched"
    assert assess_accommodation({"name": "Hostel", "room_type": "Private room", "accommodation_evidence_source": "provider"}, private_room_required=True)["status"] == "matched"
    assert assess_accommodation({"room_type": "Private room"}, "hotel", True)["status"] == "unknown"
    assert assess_accommodation({"property_type": "Vacation rental", "accommodation_evidence_source": "provider"}, "hotel")["status"] == "contradicted"
    assert assess_accommodation({"property_type": "Hotel", "accommodation_evidence_source": "provider"}, "hostel")["status"] == "contradicted"


def test_timing_unknown_missing_and_invalid_evidence():
    base_flight = {"arrival_time": "2026-12-11 00:30"}
    hotel = {"check_in_date": "2026-12-10", "check_out_date": "2026-12-12", "check_in_time": "3:00 PM"}
    result = assess_timing(base_flight, hotel)
    assert result["timing_status"] == "needs_confirmation"
    assert result["timing_reason_codes"] == ["prior_night_booking_or_late_arrival_needs_confirmation"]
    assert "reservation retention" in result["timing_message"]
    assert assess_timing({"arrival_time": "bad\u00a0time"}, hotel)["timing_status"] == "needs_confirmation"
    assert assess_timing({"arrival_time": "2026-12-10 19:00"}, {**hotel, "check_in_time": "3:00\u202fPM"})["timing_status"] == "compatible"
    assert assess_timing({"arrival_time": "2026-12-10 10:00"}, {**hotel, "check_in_time": None})["timing_status"] == "needs_confirmation"
    assert assess_timing({"arrival_time": "2026-12-10 10:00"}, {**hotel, "check_in_time": "3:00 PM", "check_out_time": "11:00 AM"})["timing_status"] == "compatible"
    assert assess_timing({"arrival_time": "2026-12-10 10:00"}, {**hotel, "check_in_time": "3:00 PM"})["timing_reason_codes"] == ["early_arrival_wait_for_checkin"]
    assert assess_timing({"arrival_time": "2026-12-12 10:00"}, hotel)["timing_status"] == "needs_confirmation"
    # Isolate the checkout comparison from the normal airport transfer buffer.
    # An arrival before a known checkout time is still provisional because the
    # booked stay ends that day; at or after checkout it cannot cover arrival.
    assert assess_timing(
        {"arrival_time": "2026-12-12 10:00"}, {**hotel, "check_out_time": "11:00 AM"}, gap_hours=0
    )["timing_status"] == "needs_confirmation"
    assert assess_timing(
        {"arrival_time": "2026-12-12 11:00"}, {**hotel, "check_out_time": "11:00 AM"}, gap_hours=0
    )["timing_status"] == "incompatible"
    assert assess_timing(
        {"arrival_time": "2026-12-12 13:00"}, {**hotel, "check_out_time": "11:00 AM"}, gap_hours=0
    )["timing_status"] == "incompatible"
    assert assess_timing(
        {"arrival_time": "2026-12-12 10:00"}, {**hotel, "check_out_time": None}, gap_hours=0
    )["timing_status"] == "needs_confirmation"
    assert assess_timing({"arrival_time": "2026-12-10 13:00"}, {**hotel, "check_out_date": "bad"})["timing_status"] == "needs_confirmation"
    assert assess_timing({"arrival_time": "2026-12-10 13:00"}, {**hotel, "check_out_date": "2026-12-10"})["timing_status"] == "incompatible"
    assert assess_timing({"arrival_time": "2026-12-10 23:30"}, {**hotel, "check_in_date": "2026-12-11", "check_in_time": "invalid"})["timing_status"] == "needs_confirmation"
    before_stay = assess_timing({"arrival_time": "2026-12-09 20:00"}, hotel)
    assert before_stay["timing_reason_codes"] == ["arrival_before_checkin_date"]


def test_checkout_time_is_not_a_checkin_cutoff_and_explicit_window_is():
    flight = {"arrival_time": "2026-12-10 19:00"}
    hotel = {"check_in_date": "2026-12-10", "check_out_date": "2026-12-12", "check_in_time": "3:00 PM", "check_out_time": "11:00 AM"}
    assert assess_timing(flight, hotel)["timing_status"] == "compatible"
    assert assess_timing(flight, {**hotel, "check_in_end_time": "6:00 PM"})["timing_status"] == "needs_confirmation"


def test_selection_prefers_compatible_then_provisional_and_excludes_contradictions():
    flight = {"price": 100, "arrival_time": "2026-12-10 18:00"}
    provisional = {"name": "Unknown", "price": 25, "total_price": 50, "overall_rating": 4.4,
                   "check_in_date": "2026-12-09", "check_out_date": "2026-12-12", "check_in_time": "3:00 PM"}
    compatible = {"name": "Known hotel", "price": 80, "total_price": 160, "overall_rating": 4.4,
                  "property_type": "Hotel", "accommodation_evidence_source": "provider", "check_in_date": "2026-12-10", "check_out_date": "2026-12-12", "check_in_time": "3:00 PM"}
    plan = find_cheapest_plan([flight], [provisional, compatible], check_in_date="2026-12-10", check_out_date="2026-12-12", accommodation_type="hotel")
    assert plan["hotel"]["name"] == compatible["name"]
    assert plan["timing_status"] == "compatible"
    assert plan["provisional"] is False
    no_confirmed = find_cheapest_plan([flight], [provisional], check_in_date="2026-12-09", check_out_date="2026-12-12")
    assert no_confirmed["provisional"] is True
    assert find_cheapest_plan([flight], [{**compatible, "name": "Hostel near city"}], accommodation_type="hotel") is None
    rating_trap = {**compatible, "name": "Known hostel", "property_type": "Hostel", "overall_rating": 4.9}
    lower_rated = {**compatible, "overall_rating": 3.8, "total_price": 180}
    plan = find_cheapest_plan([flight], [rating_trap, lower_rated], accommodation_type="hotel")
    assert plan["hotel"]["name"] == lower_rated["name"]
    assert find_cheapest_plan([flight], [{**compatible, "total_price": None, "price": None}]) is None
    assert find_cheapest_plan([flight], [{**compatible, "total_price": True}]) is None


def test_nightly_rate_is_multiplied_by_known_stay_and_not_used_without_dates():
    flight = {"price": 100, "arrival_time": "2026-12-10 18:00"}
    nightly = {
        "name": "Nightly Only", "price": 50,
        "check_in_date": "2026-12-10", "check_out_date": "2026-12-12",
        "check_in_time": "3:00 PM",
    }
    plan = find_cheapest_plan([flight], [nightly])
    assert plan["total_price"] == 200
    assert plan["hotel"]["price"] == 50
    assert find_cheapest_plan([flight], [{"name": "Nightly Only", "price": 50}]) is None


def test_provider_parser_keeps_unknown_time_and_only_explicit_accommodation_fields():
    parsed = _parse_hotel({"name": "Hostel", "rate_per_night": {"extracted_lowest": 100}}, "2026-12-10", "2026-12-12")
    assert parsed["check_in_time"] is None
    assert parsed["property_type"] is None
    assert parsed["room_type"] is None
    provider = _parse_hotel({"name": "Listing", "type": "Hotel", "rate_per_night": {"extracted_lowest": 100}}, "2026-12-10", "2026-12-12")
    assert provider["accommodation_evidence_source"] == "serpapi_google_hotels"
    assert provider["property_type"] == "Hotel"
    assert provider["room_type"] is None
    assert "check_in_end_time" not in provider
