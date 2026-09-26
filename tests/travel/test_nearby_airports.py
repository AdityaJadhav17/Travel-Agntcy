"""Generic airport discovery and priced comparison boundaries."""

import asyncio
from datetime import date, timedelta
from unittest.mock import AsyncMock

from agents.supervisors.travel.graph.graph import TravelGraph
from agents.supervisors.travel.graph.models import TravelSearchArgs
from agents.supervisors.travel.graph.nearby_airports import airport_catalog, nearby_arrivals
from agents.travel.serpapi_tools import driving_route_from_airport


def params(destination="SBP"):
    start = date.today() + timedelta(days=50)
    return TravelSearchArgs(origin="DFW", destination=destination,
                            destination_city="San Luis Obispo", search_type="flight_only",
                            start_date=str(start), end_date=str(start + timedelta(days=3)))


def quote(code, price, trip):
    return {"airline": "Fixture Air", "price": price, "currency": "USD",
            "departure_code": trip.origin, "arrival_code": code,
            "departure_time": f"{trip.start_date} 10:00", "arrival_time": f"{trip.start_date} 13:00",
            "return_flight": {"airline": "Fixture Air", "departure_code": code,
                              "arrival_code": trip.origin, "departure_time": f"{trip.end_date} 10:00",
                              "arrival_time": f"{trip.end_date} 13:00", "stops": 0}}


def test_discovery_is_bounded_generic_and_does_not_invent_road_miles():
    choices = nearby_arrivals("SBP")
    assert len(airport_catalog()) > 3000
    assert len(choices) <= 6
    assert "LAX" in {item.airport.code for item in choices}
    assert all(item.airport.country == "US" and 0 < item.straight_line_miles <= 200
               for item in choices)
    assert nearby_arrivals("JFK")
    assert nearby_arrivals("ZZZ") is None


def test_comparison_keeps_target_and_only_uses_complete_arrival_quotes(monkeypatch):
    trip = params()
    prices = {"SBP": 529, "SMX": 420, "LAX": 300}
    searched = []

    async def flights(origin, code, *_args, **_kwargs):
        searched.append(code)
        if code == "SMX":
            # An outbound fare alone is not a round-trip quote.
            return [{**quote(code, prices[code], trip), "return_flight": None}]
        return [quote(code, prices.get(code, 500), trip)]

    monkeypatch.setattr("agents.supervisors.travel.graph.graph.get_flights_via_a2a", flights)
    monkeypatch.setattr("agents.supervisors.travel.graph.graph.driving_route_from_airport",
                        AsyncMock(return_value={"miles": 175.5, "minutes": 190}))
    result = asyncio.run(TravelGraph()._handle_nearby_airport_search(trip))
    data = result["travel_result"]
    assert data["kind"] == "airport_comparison"
    assert data["requested_airport"] == "SBP" and data["requested_fare_usd"] == 529
    assert "SBP" in searched and "LAX" in searched and len(searched) <= 7
    assert "SMX" not in {item["arrival_airport"] for item in data["airport_alternatives"]}
    lax = next(item for item in data["airport_alternatives"] if item["arrival_airport"] == "LAX")
    assert lax["fare_usd"] == 300 and lax["savings_usd"] == 229
    assert lax["driving_miles"] == 175.5 and lax["straight_line_miles"] > 0
    assert trip.destination == "SBP"


def test_missing_catalog_entry_and_unavailable_routes_stay_explicit(monkeypatch):
    no_catalog = asyncio.run(TravelGraph()._handle_nearby_airport_search(params("ZZZ")))
    assert "confirm" in no_catalog["full_response"]
    assert "travel_result" not in no_catalog

    trip = params()

    async def flights(_origin, code, *_args, **_kwargs):
        return [quote(code, 500 if code == "SBP" else 400, trip)]

    monkeypatch.setattr("agents.supervisors.travel.graph.graph.get_flights_via_a2a", flights)
    monkeypatch.setattr("agents.supervisors.travel.graph.graph.driving_route_from_airport",
                        AsyncMock(return_value=None))
    data = asyncio.run(TravelGraph()._handle_nearby_airport_search(trip))["travel_result"]
    assert any(item["driving_miles"] is None and item["straight_line_miles"] > 0
               for item in data["airport_alternatives"] if item["arrival_airport"] != "SBP")
    assert "Ground-transfer cost is unknown" in data["notice"]


def test_directions_parser_uses_only_numeric_driving_routes(monkeypatch):
    search = AsyncMock(return_value={"directions": [{"travel_mode": "Driving",
                                                     "distance": 160934, "duration": 7200}]})
    monkeypatch.setattr("agents.travel.serpapi_tools._request_search", search)
    route = asyncio.run(driving_route_from_airport(35.2, -120.6, "San Luis Obispo", "US"))
    assert route == {"miles": 100.0, "minutes": 120}
    assert search.await_args.args[0]["engine"] == "google_maps_directions"
    search.return_value = {"directions": [{"travel_mode": "Walking", "distance": 1000, "duration": 500}]}
    assert asyncio.run(driving_route_from_airport(35.2, -120.6, "San Luis Obispo", "US")) is None


def test_arrival_intent_is_not_departure_airport_intent():
    detect = TravelGraph._nearby_arrival_request
    assert detect("Can you find cheaper flights to nearby airports to SBP?")
    assert detect("Compare nearby arrival airports")
    assert not detect("Search departure airports near DFW")
