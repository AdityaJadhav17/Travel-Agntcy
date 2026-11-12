"""Offline graph regressions for lodging eligibility, stay dates, and uncertainty."""

import asyncio
from datetime import date, timedelta
from unittest.mock import AsyncMock

from agents.supervisors.travel.graph.graph import TravelGraph
from agents.supervisors.travel.graph.models import TravelSearchArgs
from agents.supervisors.travel.graph.recommendations import capture_recommendation
from agents.travel.travel_logic import find_cheapest_plan


def dates():
    start = date.today() + timedelta(days=30)
    return start, start + timedelta(days=3)


def params(**updates):
    start, end = dates()
    return TravelSearchArgs(**{
        "search_type": "full_trip", "origin": "DFW", "destination": "JFK",
        "destination_city": "New York", "start_date": str(start), "end_date": str(end),
        "adults": 1, "budget_currency": "USD", "budget_scope": "quoted_total",
        **updates,
    })


def flight(trip, *, arrival=None):
    return {
        "airline": "Fixture Air", "price": 240, "currency": "USD",
        "departure_code": trip.origin, "arrival_code": trip.destination,
        "departure_time": f"{trip.start_date} 08:00",
        "arrival_time": arrival or f"{trip.hotel_check_in_date or trip.start_date} 18:00",
        "stops": 0,
        "return_flight": None if trip.is_one_way else {
            "airline": "Fixture Air", "departure_code": trip.destination,
            "arrival_code": trip.origin, "departure_time": f"{trip.end_date} 10:00",
            "arrival_time": f"{trip.end_date} 13:00", "stops": 0,
        },
    }


def hotel(name="Central Hotel", *, check_in=None, check_out=None, total=300, kind="Hotel"):
    start, end = dates()
    return {
        "name": name, "price": total / 3, "total_price": total, "currency": "USD",
        "overall_rating": 4.5, "property_type": kind,
        "accommodation_evidence_source": "serpapi_google_hotels",
        "check_in_date": check_in or str(start), "check_out_date": check_out or str(end),
        "check_in_time": "3:00 PM",
    }


def test_hotel_only_filters_contradictions_before_budget_assessment(monkeypatch):
    start, end = dates()
    trip = params(search_type="hotel_only", location="New York", start_date=str(start), end_date=str(end),
                  accommodation_type="hotel", budget_amount=150)
    hostelly = hotel("Cheap Hostel", total=30, kind="Hostel")
    hotel_over_budget = hotel("Eligible Hotel", total=300, kind="Hotel")
    provider = AsyncMock(return_value=[hostelly, hotel_over_budget])
    monkeypatch.setattr("agents.supervisors.travel.graph.graph.get_hotels_via_a2a", provider)

    result = asyncio.run(TravelGraph()._handle_hotel_only_search(trip))

    provider.assert_awaited_once_with("New York", str(start), str(end), party=trip)
    assert result["budget_assessment"]["status"] == "over"
    assert result["budget_assessment"]["quoted_total"] == 300
    assert "Eligible Hotel" not in result.get("full_response", "")


def test_initial_and_retry_hotel_searches_use_explicit_stay_dates(monkeypatch):
    start, end = dates()
    check_in, check_out = start + timedelta(days=1), end + timedelta(days=2)
    trip = params(hotel_check_in_date=str(check_in), hotel_check_out_date=str(check_out))
    flight_quote = flight(trip)
    quoted_hotel = hotel(check_in=str(check_in), check_out=str(check_out))
    provider = AsyncMock(side_effect=[RuntimeError("first failure"), [quoted_hotel]])
    flight_provider = AsyncMock(return_value=[flight_quote])
    monkeypatch.setattr("agents.supervisors.travel.graph.graph.get_flights_via_a2a", flight_provider)
    monkeypatch.setattr("agents.supervisors.travel.graph.graph.get_hotels_via_a2a", provider)
    monkeypatch.setattr("agents.supervisors.travel.graph.graph.get_activities_via_a2a", AsyncMock(return_value=[]))
    graph = TravelGraph()

    partial = asyncio.run(graph._handle_full_trip_search(trip))
    complete = asyncio.run(graph._retry_hotels_node({"partial_search": partial["partial_search"]}))

    assert [call.args[1:3] for call in provider.await_args_list] == [
        (str(check_in), str(check_out)), (str(check_in), str(check_out)),
    ]
    assert complete["travel_result"]["hotel_check_in_date"] == str(check_in)
    assert complete["travel_result"]["hotel_check_out_date"] == str(check_out)


def test_replacement_hotel_search_uses_explicit_stay_dates(monkeypatch):
    start, end = dates()
    check_in, check_out = start + timedelta(days=1), end + timedelta(days=2)
    trip = params(hotel_check_in_date=str(check_in), hotel_check_out_date=str(check_out))
    selected_flight = flight(trip)
    selected_hotel = hotel("Selected", check_in=str(check_in), check_out=str(check_out))
    plan = find_cheapest_plan([selected_flight], [selected_hotel],
                              check_in_date=str(check_in), check_out_date=str(check_out))
    saved = capture_recommendation(plan, trip)
    replacement = hotel("Replacement", check_in=str(check_in), check_out=str(check_out), total=360)
    provider = AsyncMock(return_value=[selected_hotel, replacement])
    monkeypatch.setattr("agents.supervisors.travel.graph.graph.get_hotels_via_a2a", provider)

    result = asyncio.run(TravelGraph()._change_hotel_node({"recommendation": saved}))

    provider.assert_awaited_once_with("New York", str(check_in), str(check_out), party=trip)
    assert result["travel_result"]["hotel_check_in_date"] == str(check_in)
    assert result["travel_result"]["hotel_check_out_date"] == str(check_out)


def test_no_compatible_pair_preserves_separate_flight_and_hotel_cards():
    start, end = dates()
    trip = params(hotel_check_in_date=str(start), hotel_check_out_date=str(end))
    flight_quote = flight(trip, arrival=f"{end} 23:00")
    quoted_hotel = hotel(check_in=str(start), check_out=str(end))
    graph = TravelGraph()

    result = asyncio.run(graph._complete_full_trip(trip, [flight_quote], [quoted_hotel], str(end), "New York"))

    travel = result.get("travel_result") or {}
    assert travel.get("flights") and travel.get("hotels")
    assert "timing" in result.get("full_response", "").lower() or "arrival" in result.get("full_response", "").lower()
    assert travel.get("total_usd") is None


def test_removing_private_room_requirement_preserves_explicit_stay_dates():
    start, end = dates()
    trip = params(hotel_check_in_date=str(start + timedelta(days=1)),
                  hotel_check_out_date=str(end + timedelta(days=2)),
                  private_room_required=True)

    updated = TravelGraph._apply_explicit_scope(
        params(), "remove the private room requirement", trip.model_dump())

    assert updated.private_room_required is False
    assert updated.hotel_check_in_date == trip.hotel_check_in_date
    assert updated.hotel_check_out_date == trip.hotel_check_out_date


def test_one_way_explicit_checkout_is_not_replaced_by_implicit_one_night(monkeypatch):
    start, _ = dates()
    check_in, check_out = start + timedelta(days=1), start + timedelta(days=5)
    trip = params(is_one_way=True, end_date=None,
                  hotel_check_in_date=str(check_in), hotel_check_out_date=str(check_out))
    flight_quote = flight(trip)
    quoted_hotel = hotel(check_in=str(check_in), check_out=str(check_out), total=500)
    flight_provider = AsyncMock(return_value=[flight_quote])
    hotel_provider = AsyncMock(return_value=[quoted_hotel])
    monkeypatch.setattr("agents.supervisors.travel.graph.graph.get_flights_via_a2a", flight_provider)
    monkeypatch.setattr("agents.supervisors.travel.graph.graph.get_hotels_via_a2a", hotel_provider)
    monkeypatch.setattr("agents.supervisors.travel.graph.graph.get_activities_via_a2a", AsyncMock(return_value=[]))

    result = asyncio.run(TravelGraph()._handle_full_trip_search(trip))

    hotel_provider.assert_awaited_once_with("New York", str(check_in), str(check_out), party=trip)
    assert result["travel_result"]["hotel_check_out_date"] == str(check_out)
