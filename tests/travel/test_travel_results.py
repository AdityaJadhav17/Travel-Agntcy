"""Structured cards are derived from provider quotes, never from response prose."""

import asyncio
from datetime import date, timedelta
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from agents.supervisors.travel.graph.graph import TravelGraph
from agents.supervisors.travel.graph.models import TravelSearchArgs
from agents.supervisors.travel.graph.recommendations import quote_facts
from agents.supervisors.travel.graph.travel_results import TravelResult, travel_result


def trip(**changes):
    start = date.today() + timedelta(days=30)
    return TravelSearchArgs(**{
        "origin": "DFW", "destination": "JFK", "destination_city": "New York",
        "start_date": str(start), "end_date": str(start + timedelta(days=3)),
        **changes,
    })


def test_full_trip_cards_use_quote_prices_and_bounded_provider_labels():
    params = trip(adults=2, children=1, children_ages=[8])
    flight = {
        "airline": "<Fixture Air>", "price": 240, "currency": "USD",
        "departure_time": f"{params.start_date} 10:00", "arrival_time": f"{params.start_date} 13:00",
        "return_flight": {"airline": "Fixture Air", "departure_time": f"{params.end_date} 10:00",
                          "arrival_time": f"{params.end_date} 13:00", "stops": 0},
    }
    hotel = {"name": "Central Hotel", "price": 100, "total_price": 300,
             "currency": "USD", "overall_rating": 4.6}
    data = travel_result("full_trip", params, flights=[flight], hotels=[hotel],
                         activities=[{"name": "City Museum", "type": "Museum", "rating": 4.8}])
    assert data["version"] == 1
    assert data["kind"] == "full_trip"
    assert data["total_usd"] == 540
    assert data["flights"][0]["airline"] == "Fixture Air"
    assert data["flights"][0]["return_flight"]["airline"] == "Fixture Air"
    assert data["hotels"][0]["total_usd"] == 300
    assert data["activities"][0]["name"] == "City Museum"
    assert data["adults"] == 2 and data["children"] == 1
    assert TravelResult.model_validate(data).model_dump(mode="json") == data


def test_missing_or_foreign_prices_are_unknown_not_zero_or_usd():
    params = trip(search_type="hotel_only")
    data = travel_result("hotel_only", params, hotels=[
        {"name": "Unknown", "price": 1, "currency": "EUR", "overall_rating": float("nan")},
        {"name": "Nightly", "price": 100, "currency": "USD"},
    ])
    assert data["hotels"][0]["total_usd"] is None
    assert data["hotels"][0]["nightly_usd"] is None
    assert data["hotels"][0]["overall_rating"] is None
    assert data["hotels"][1]["total_usd"] == 300


def test_hotel_cards_preserve_bounded_evidence_match_and_actual_stay_dates():
    params = trip(hotel_check_in_date="2030-01-02", hotel_check_out_date="2030-01-06",
                  accommodation_type="hotel", private_room_required=True)
    data = travel_result("hotel_only", params, hotels=[{
        "name": "Evidence Hotel", "price": 125, "currency": "USD",
        "property_type": "hotel", "room_type": "private room",
        "accommodation_evidence_source": "serpapi_google_hotels",
        "accommodation_status": "matched", "accommodation_reasons": ["private_room_evidence", "room_privacy_unverified"],
        "check_in_date": "2030-01-02", "check_out_date": "2030-01-06",
        "timing_status": "needs_confirmation", "timing_reason_codes": ["late_arrival_retention_unknown"],
        "timing_message": "Late arrival retention needs confirmation.", "arrival_at_hotel": "2030-01-03 02:30",
        "provisional": True,
    }])
    hotel = data["hotels"][0]
    assert hotel["property_type"] == "hotel"
    assert hotel["room_type"] == "private room"
    assert hotel["accommodation_evidence_source"] == "serpapi_google_hotels"
    assert hotel["accommodation_reasons"] == ["private_room_evidence", "room_privacy_unverified"]
    assert hotel["timing_reason_codes"] == ["late_arrival_retention_unknown"]
    assert hotel["accommodation_status"] == "matched"
    assert hotel["timing_status"] == "needs_confirmation"
    assert hotel["provisional"] is True
    assert data["hotel_check_in_date"] == "2030-01-02"
    assert data["hotel_check_out_date"] == "2030-01-06"


def test_hotel_card_ids_match_recommendation_for_default_and_explicit_stay_dates():
    hotel = {"name": "Same Hotel", "price": 100, "currency": "USD", "total_price": 300}
    params = trip()
    default_card = travel_result(
        "full_trip", params, flights=[{"airline": "Fixture Air", "price": 200, "currency": "USD"}],
        hotels=[hotel], hotel_check_in_date=params.start_date,
        hotel_check_out_date=params.end_date,
    )["hotels"][0]
    assert default_card["id"] == quote_facts(hotel, "hotel", params).id

    explicit = params.model_copy(update={
        "hotel_check_in_date": "2030-01-02", "hotel_check_out_date": "2030-01-06",
    })
    explicit_card = travel_result("full_trip", explicit,
        flights=[{"airline": "Fixture Air", "price": 200, "currency": "USD"}], hotels=[hotel])["hotels"][0]
    assert explicit_card["id"] == quote_facts(hotel, "hotel", explicit).id


def test_old_saved_hotel_cards_load_with_unknown_accommodation_and_timing():
    params = trip(search_type="hotel_only")
    data = travel_result("hotel_only", params, hotels=[{"name": "Legacy Hotel", "price": 100, "currency": "USD"}])
    old_card = {key: value for key, value in data["hotels"][0].items() if key in {
        "id", "name", "nightly_usd", "total_usd", "overall_rating", "location_rating"
    }}
    validated = TravelResult.model_validate({**data, "hotels": [old_card]})
    assert validated.hotels[0].accommodation_status == "unknown"
    assert validated.hotels[0].timing_status is None


def test_presentation_count_matches_requested_count_and_explains_shortfall_or_cap():
    params = trip(search_type="activity_only", activity_result_count=3)
    activities = [{"name": f"Activity {index}", "type": "Museum"} for index in range(1, 6)]
    selected = travel_result("activity_only", params, activities=activities)
    assert [item["name"] for item in selected["activities"]] == ["Activity 1", "Activity 2", "Activity 3"]
    assert selected["activity_result_count"] == 3
    fewer = travel_result("activity_only", params, activities=activities[:2])
    assert len(fewer["activities"]) == 2
    assert "Only 2 eligible options were found." in fewer["notice"]
    capped = travel_result("activity_only", trip(search_type="activity_only", activity_result_count=7), activities=activities)
    assert len(capped["activities"]) == 5
    assert "Showing up to 5 options per request." in capped["notice"]


def test_unpaired_full_trip_keeps_separate_quotes_without_a_combined_total():
    params = trip()
    flights = [
        {"airline": f"Fixture Air {index}", "price": 200 + index, "currency": "USD",
         "departure_time": f"{params.start_date} 10:00", "arrival_time": f"{params.start_date} 13:00"}
        for index in range(2)
    ]
    hotels = [
        {"name": f"Fixture Hotel {index}", "price": 100 + index, "currency": "USD", "total_price": 300 + index}
        for index in range(2)
    ]
    data = travel_result("full_trip", params, flights=flights, hotels=hotels, combine_quotes=False)
    assert len(data["flights"]) == 2
    assert len(data["hotels"]) == 2
    assert data["total_usd"] is None
    assert "no compatible pairing was confirmed" in data["notice"]


def test_schema_rejects_missing_options_and_unknown_versions():
    params = trip(search_type="flight_only")
    with pytest.raises(ValidationError):
        travel_result("flight_only", params)
    data = travel_result("flight_only", params, flights=[{"airline": "Test", "currency": "USD", "price": 10}])
    with pytest.raises(ValidationError):
        TravelResult.model_validate({**data, "version": 2})


def test_search_result_is_attached_to_graph_success_only(monkeypatch):
    params = trip(search_type="flight_only")
    search = AsyncMock(return_value=[{"airline": "Fixture Air", "price": 240,
                                      "currency": "USD", "departure_time": f"{params.start_date} 10:00",
                                      "arrival_time": f"{params.start_date} 13:00"}])
    monkeypatch.setattr("agents.supervisors.travel.graph.graph.get_flights_via_a2a", search)
    result = asyncio.run(TravelGraph()._handle_flight_only_search(params))
    assert result["travel_result"]["flights"][0]["total_usd"] == 240
    search.return_value = []
    missing = asyncio.run(TravelGraph()._handle_flight_only_search(params))
    assert "travel_result" not in missing
