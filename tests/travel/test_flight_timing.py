"""Flight timing across conversation, transport, and priced provider fixtures."""

import asyncio
from datetime import date, timedelta
from unittest.mock import AsyncMock

from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableLambda

from agents.flight.agent import FlightSearchAgent
from agents.supervisors.travel.graph import tools
from agents.supervisors.travel.graph.graph import TravelGraph
from agents.supervisors.travel.graph.models import TravelSearchArgs
from agents.travel import serpapi_tools as serp
from agents.travel.flight_timing import FlightTiming, LocalWindow, simple_timing_edit


def _flight(departure, price, *, arrival="21:00", origin="DFW", destination="JFK", token=None):
    return {
        "price": price, "departure_token": token, "total_duration": 180,
        "flights": [{
            "departure_airport": {"time": departure, "id": origin},
            "arrival_airport": {"time": arrival, "id": destination},
            "airline": "Fixture Air",
        }],
    }


def test_local_window_uses_airport_clock_and_exact_boundaries():
    window = LocalWindow(start="18:30", end="24:00")
    assert window.provider_range() == "18,23"
    assert not window.matches("2030-08-01 18:29")
    assert window.matches("2030-08-01T18:30:00-04:00")
    assert not window.matches("2030-08-02 00:01")
    assert not window.matches("unknown")
    overnight = LocalWindow(start="22:00", end="06:00")
    assert overnight.matches("23:00") and overnight.matches("05:59")
    assert not overnight.matches("06:00")
    assert overnight.provider_range() == "0,23"


def test_exact_edits_keep_other_leg_and_arrival_windows():
    original = FlightTiming(return_departure=LocalWindow(start="06:00", end="12:00"))
    edited = simple_timing_edit("Actually, leave after 6:30 p.m.", original)
    assert edited.outbound_departure.start == "18:30"
    assert edited.return_departure == original.return_departure
    assert "7 a.m. or 7 p.m." in simple_timing_edit("after 7", original)
    arriving = simple_timing_edit("Arrive before noon on the return", edited)
    assert arriving.return_arrival.end == "12:00"
    assert arriving.return_departure == original.return_departure
    assert simple_timing_edit("any time", arriving) == FlightTiming()


def test_roundtrip_filters_returns_before_publishing_a_verified_quote(monkeypatch):
    timing = FlightTiming(
        outbound_departure=LocalWindow(start="18:30", end="24:00"),
        return_arrival=LocalWindow(start="00:00", end="12:00"),
    )
    request = AsyncMock(side_effect=[
        {"other_flights": [
            _flight("2030-08-01 18:15", 100, token="early"),
            _flight("2030-08-01 18:30", 200, arrival="2030-08-01 21:30", token="match"),
        ]},
        {"other_flights": [
            _flight("2030-08-05 10:00", 220, arrival="2030-08-05 12:00", origin="JFK", destination="DFW"),
            _flight("2030-08-05 08:00", 260, arrival="2030-08-05 10:00", origin="JFK", destination="DFW"),
        ]},
    ])
    monkeypatch.setattr(serp, "_request_provider", request)
    monkeypatch.setattr(serp, "SERPAPI_API_KEY", "fixture")
    preview = []
    flights = asyncio.run(serp.search_flights(
        "DFW", "JFK", "2030-08-01", "2030-08-05", flight_timing=timing,
        on_verified_preview=preview.append,
    ))
    assert request.await_count == 2
    initial, lookup = [call.args[0] for call in request.await_args_list]
    assert initial["outbound_times"] == "18,23"
    assert lookup["return_times"] == "0,23,0,11"
    assert lookup["departure_token"] == "match"
    assert [quote["price"] for quote in flights] == [260]
    assert preview[0]["total_usd"] == 260


def test_conversation_edits_evening_flights_and_compares_existing_route(monkeypatch):
    departure = (date.today() + timedelta(days=30)).isoformat()
    graph = TravelGraph()
    graph.supervisor_llm = RunnableLambda(lambda _: AIMessage(content="travel_search"))
    initial = TravelSearchArgs(
        search_type="flight_only", origin="DFW", destination="JFK",
        start_date=departure, is_one_way=True, adults=2, flight_result_count=2,
        flight_timing=FlightTiming(outbound_departure=LocalWindow(start="18:00", end="24:00")),
    )
    extract = AsyncMock(return_value=initial)
    monkeypatch.setattr(graph, "_extract_travel_params", extract)
    agent = FlightSearchAgent()
    monkeypatch.setattr(tools, "preview_enabled", lambda: False)
    monkeypatch.setattr(tools, "_send_a2a_message", lambda _, query: agent.ainvoke(query))
    monkeypatch.setattr(serp, "SERPAPI_API_KEY", "fixture")
    provider = AsyncMock(return_value={"other_flights": [
        _flight(f"{departure} 09:00", 110),
        _flight(f"{departure} 10:00", 115),
        _flight(f"{departure} 15:00", 120),
        _flight(f"{departure} 17:59", 130),
        _flight(f"{departure} 18:00", 145),
        _flight(f"{departure} 19:30", 155),
    ]})
    monkeypatch.setattr(serp, "_request_provider", provider)

    evening = asyncio.run(graph.serve_conversation(
        f"Find evening flights from Dallas to New York on {departure} for two", [], {},
    ))
    assert [card["departure_time"][-5:] for card in evening["travel_result"]["flights"]] == ["18:00", "19:30"]
    assert "18:00–24:00" in evening["travel_result"]["notice"]

    afternoon = asyncio.run(graph.serve_conversation("How about afternoon flights?", [], evening["trip_state"]))
    assert afternoon["trip_state"]["adults"] == 2
    assert afternoon["trip_state"]["start_date"] == departure
    assert afternoon["travel_result"]["flights"][0]["departure_time"].endswith("15:00")

    compared = asyncio.run(graph.serve_conversation("Different times of the day", [], afternoon["trip_state"]))
    assert [card["departure_time"][-5:] for card in compared["travel_result"]["flights"]] == ["09:00", "15:00"]
    named = asyncio.run(graph.serve_conversation("Compare early morning vs evening", [], compared["trip_state"]))
    assert [card["departure_time"][-5:] for card in named["travel_result"]["flights"]] == ["18:00", "19:30"]
    assert "No outbound quote shown for early morning" in named["travel_result"]["notice"]
    assert "outbound_times" not in provider.await_args.args[0]

    ambiguous = asyncio.run(graph.serve_conversation("After 7", [], named["trip_state"]))
    assert "7 a.m. or 7 p.m." in ambiguous["response"]
    assert provider.await_count == 4
    no_match = asyncio.run(graph.serve_conversation("Leave after 10 p.m.", [], ambiguous["trip_state"]))
    assert no_match["travel_result"] is None and "22:00–24:00" in no_match["response"]
    assert "any time" in no_match["response"]
    relaxed = asyncio.run(graph.serve_conversation("Any time", [], no_match["trip_state"]))
    assert relaxed["trip_state"]["flight_timing"] is None
    assert relaxed["travel_result"]["flights"][1]["departure_time"].endswith("10:00")
    extract.assert_awaited_once()
