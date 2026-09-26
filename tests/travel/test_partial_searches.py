"""A hotel failure keeps useful flights and retries hotels without duplicate flight work."""

import asyncio
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock

from agents.supervisors.travel.graph import graph as graph_module
from agents.supervisors.travel.graph.graph import TravelGraph
from agents.supervisors.travel.graph.models import TravelSearchArgs
from agents.supervisors.travel.graph.partial_searches import PartialSearch, retain_flights


def trip():
    start = date.today() + timedelta(days=30)
    return TravelSearchArgs(
        origin="DFW", destination="JFK", destination_city="New York",
        start_date=str(start), end_date=str(start + timedelta(days=3)),
    )


def quotes(params):
    flight = {
        "airline": "Fixture Air", "price": 240, "currency": "USD",
        "departure_time": f"{params.start_date} 10:00",
        "arrival_time": f"{params.start_date} 13:00",
        "departure_code": "DFW", "arrival_code": "JFK", "stops": 0,
        "return_flight": {
            "airline": "Fixture Air", "departure_time": f"{params.end_date} 10:00",
            "arrival_time": f"{params.end_date} 13:00", "stops": 0,
        },
    }
    hotel = {"name": "Central Hotel", "price": 100, "total_price": 300,
             "currency": "USD", "overall_rating": 4.6}
    return flight, hotel


def install(monkeypatch, flights, hotels):
    flight_search = AsyncMock(return_value=flights)
    hotel_search = AsyncMock(side_effect=hotels)
    monkeypatch.setattr(graph_module, "get_flights_via_a2a", flight_search)
    monkeypatch.setattr(graph_module, "get_hotels_via_a2a", hotel_search)
    monkeypatch.setattr(graph_module, "get_activities_via_a2a", AsyncMock(return_value=[]))
    return flight_search, hotel_search


def test_hotel_error_retains_flights_and_focused_retry_uses_them(monkeypatch):
    params = trip()
    flight, hotel = quotes(params)
    flight_search, hotel_search = install(monkeypatch, [flight], [RuntimeError("provider private"), [hotel]])
    graph = TravelGraph()
    partial = asyncio.run(graph._handle_full_trip_search(params))
    assert partial["travel_result"]["kind"] == "flight_only"
    assert partial["retry_hotels"] is True
    assert "provider private" not in partial["full_response"]
    assert PartialSearch.model_validate(partial["partial_search"]).flights[0].itinerary.price == 240
    completed = asyncio.run(graph._retry_hotels_node({"partial_search": partial["partial_search"]}))
    assert completed["travel_result"]["kind"] == "full_trip"
    assert completed["travel_result"]["total_usd"] == 540
    assert completed["partial_search"] is None
    assert flight_search.await_count == 1
    assert hotel_search.await_count == 2


def test_empty_hotels_are_distinct_and_retry_limit_is_bounded(monkeypatch):
    params = trip()
    flight, _ = quotes(params)
    _, hotel_search = install(monkeypatch, [flight], [[], [], []])
    graph = TravelGraph()
    first = asyncio.run(graph._handle_full_trip_search(params))
    assert "returned no options" in first["full_response"]
    assert first["partial_search"]["reason"] == "empty"
    second = asyncio.run(graph._retry_hotels_node({"partial_search": first["partial_search"]}))
    assert second["retry_hotels"] is True
    third = asyncio.run(graph._retry_hotels_node({"partial_search": second["partial_search"]}))
    assert third["retry_hotels"] is False
    assert third["partial_search"] is None
    assert hotel_search.await_count == 3


def test_provider_timeout_is_bounded_and_same_stale_flight_is_rechecked(monkeypatch):
    params = trip()
    flight, hotel = quotes(params)
    async def slow_hotels(*_, **__):
        await asyncio.sleep(0.1)
        return [hotel]
    flight_search, _ = install(monkeypatch, [flight], [RuntimeError("unused")])
    monkeypatch.setattr(graph_module, "PROVIDER_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(graph_module, "get_hotels_via_a2a", slow_hotels)
    graph = TravelGraph()
    partial = asyncio.run(graph._handle_full_trip_search(params))
    assert partial["partial_search"]["reason"] == "error"
    partial["partial_search"]["searched_at"] = (datetime.now(timezone.utc) - timedelta(minutes=6)).isoformat()
    monkeypatch.setattr(graph_module, "PROVIDER_TIMEOUT_SECONDS", 1)
    monkeypatch.setattr(graph_module, "get_hotels_via_a2a", AsyncMock(return_value=[hotel]))
    completed = asyncio.run(graph._retry_hotels_node({"partial_search": partial["partial_search"]}))
    assert completed["travel_result"]["total_usd"] == 540
    assert flight_search.await_count == 2


def test_retry_snapshot_skips_unverifiable_flights_and_expires_after_two_attempts():
    params = trip()
    flight, _ = quotes(params)
    saved = retain_flights([
        {**flight, "currency": "EUR"},
        {**flight, "airline": "X" * 161},
        flight,
    ], params, params.end_date, "error")
    assert len(saved["flights"]) == 1
    assert saved["flights"][0]["itinerary"]["airline"] == "Fixture Air"
    assert retain_flights([flight], params, params.end_date, "error", attempts=2) is None
