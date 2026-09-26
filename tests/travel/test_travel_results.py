"""Structured cards are derived from provider quotes, never from response prose."""

import asyncio
from datetime import date, timedelta
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from agents.supervisors.travel.graph.graph import TravelGraph
from agents.supervisors.travel.graph.models import TravelSearchArgs
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
