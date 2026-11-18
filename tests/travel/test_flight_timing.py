"""Flight timing across conversation, transport, and priced provider fixtures."""

import asyncio
from datetime import date, timedelta
from unittest.mock import AsyncMock

import pytest
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableLambda

from agents.flight.agent import FlightSearchAgent
from agents.supervisors.travel.graph import tools
from agents.supervisors.travel.graph.graph import TravelGraph
from agents.supervisors.travel.graph.models import TravelSearchArgs
from agents.supervisors.travel.graph.travel_results import PARTIAL_RETURN_NOTICE
from agents.travel import serpapi_tools as serp
from agents.travel.flight_timing import FlightTiming, LocalWindow, simple_timing_edit


def _flight(departure, price, *, arrival="21:00", origin="DFW", destination="JFK", token=None, number="FX 1"):
    return {
        "price": price, "departure_token": token, "total_duration": 180,
        "flights": [{
            "departure_airport": {"time": departure, "id": origin},
            "arrival_airport": {"time": arrival, "id": destination},
            "airline": "Fixture Air",
            "flight_number": number,
        }],
    }


@pytest.fixture
def flight_graph(monkeypatch):
    graph = TravelGraph()
    graph.supervisor_llm = RunnableLambda(lambda _: AIMessage(content="travel_search"))
    agent = FlightSearchAgent()
    monkeypatch.setattr(tools, "preview_enabled", lambda: False)
    monkeypatch.setattr(tools, "_send_a2a_message", lambda _, query: agent.ainvoke(query))
    monkeypatch.setattr(serp, "SERPAPI_API_KEY", "fixture")
    return graph


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
    clarification = simple_timing_edit("arrive before 7 on the return", original)
    assert "7 a.m. or 7 p.m." in clarification.question()
    assert clarification.resolve("PM", original).return_arrival == LocalWindow(start="00:00", end="19:00")
    assert clarification.resolve("PM", original).return_departure == original.return_departure
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


def test_conversation_edits_evening_flights_and_compares_existing_route(monkeypatch, flight_graph):
    departure = (date.today() + timedelta(days=30)).isoformat()
    graph = flight_graph
    initial = TravelSearchArgs(
        search_type="flight_only", origin="DFW", destination="JFK",
        start_date=departure, is_one_way=True, adults=2, flight_result_count=2,
        flight_timing=FlightTiming(outbound_departure=LocalWindow(start="18:00", end="24:00")),
    )
    extract = AsyncMock(return_value=initial)
    monkeypatch.setattr(graph, "_extract_travel_params", extract)
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
    resolved = asyncio.run(graph.serve_conversation("PM", [], ambiguous["trip_state"]))
    assert [card["departure_time"][-5:] for card in resolved["travel_result"]["flights"]] == ["19:30"]
    assert resolved["trip_state"]["pending_flight_clock"] is None
    assert provider.await_count == 5
    no_match = asyncio.run(graph.serve_conversation("Leave after 10 p.m.", [], resolved["trip_state"]))
    assert no_match["travel_result"] is None and "22:00–24:00" in no_match["response"]
    assert "any time" in no_match["response"]
    relaxed = asyncio.run(graph.serve_conversation("Any time", [], no_match["trip_state"]))
    assert relaxed["trip_state"]["flight_timing"] is None
    assert relaxed["travel_result"]["flights"][1]["departure_time"].endswith("10:00")
    extract.assert_awaited_once()


def test_date_comparison_applies_a_new_window_without_moving_the_saved_trip(monkeypatch, flight_graph):
    start = (date.today() + timedelta(days=30)).isoformat()
    saved = TravelSearchArgs(search_type="flight_only", origin="DFW", destination="JFK",
                             start_date=start, is_one_way=True, adults=2).model_dump()

    async def quote(query):
        day = query["outbound_date"]
        return {"other_flights": [_flight(f"{day} 09:00", 90), _flight(f"{day} 19:00", 160)]}

    provider = AsyncMock(side_effect=quote)
    monkeypatch.setattr(serp, "_request_provider", provider)
    result = asyncio.run(flight_graph.serve_conversation("Show cheaper dates, but only evening flights", [], saved))
    assert result["trip_state"]["start_date"] == start
    assert result["trip_state"]["adults"] == 2
    assert result["trip_state"]["flight_timing"]["outbound_departure"]["start"] == "18:00"
    assert len(result["travel_result"]["date_alternatives"]) == 7
    assert all(row["flight"]["departure_time"].endswith("19:00") for row in result["travel_result"]["date_alternatives"])
    assert all(call.args[0]["outbound_times"] == "18,23" for call in provider.await_args_list)
    assert "18:00–24:00" in result["travel_result"]["notice"]

    pending = asyncio.run(flight_graph.serve_conversation("Show cheaper dates, but leave after 7", [], saved))
    assert pending["trip_state"]["pending_flight_clock"]["compare_dates"]
    assert provider.await_count == 7
    resumed = asyncio.run(flight_graph.serve_conversation("PM", [], pending["trip_state"]))
    assert resumed["travel_result"]["kind"] == "date_comparison"
    assert provider.await_count == 14
    assert provider.await_args.args[0]["outbound_times"] == "19,23"


def test_preferred_window_uses_only_explicit_fallback(monkeypatch, flight_graph):
    start = (date.today() + timedelta(days=30)).isoformat()
    saved = TravelSearchArgs(search_type="flight_only", origin="DFW", destination="JFK",
                             start_date=start, is_one_way=True).model_dump()
    alternatives = [_flight(f"{start} 09:00", 90), _flight(f"{start} 15:00", 130)]
    provider = AsyncMock(side_effect=[
        {"other_flights": alternatives + [_flight(f"{start} 19:00", 180)]},
        {"other_flights": alternatives},
    ])
    monkeypatch.setattr(serp, "_request_provider", provider)
    prompt = "Evening if possible, but afternoon is fine"
    preferred = asyncio.run(flight_graph.serve_conversation(prompt, [], saved))
    assert [flight["total_usd"] for flight in preferred["travel_result"]["flights"]] == [180]
    fallback = asyncio.run(flight_graph.serve_conversation(prompt, [], preferred["trip_state"]))
    assert [flight["total_usd"] for flight in fallback["travel_result"]["flights"]] == [130]
    assert "accepted fallback" in fallback["travel_result"]["notice"]
    assert provider.await_count == 2
    assert provider.await_args.args[0]["outbound_times"] == "12,23"


def test_later_returns_reprice_only_the_saved_outbound(monkeypatch, flight_graph):
    start = (date.today() + timedelta(days=30)).isoformat()
    end = (date.today() + timedelta(days=33)).isoformat()
    saved = TravelSearchArgs(search_type="flight_only", origin="DFW", destination="JFK",
                             start_date=start, end_date=end)
    monkeypatch.setattr(flight_graph, "_extract_travel_params", AsyncMock(return_value=saved))
    searches = []
    later = False

    async def quote(query):
        token = query.get("departure_token")
        searches.append(token)
        if not token:
            return {"other_flights": [
                _flight(f"{start} 08:00", 90 if later else 180, token="other", number="FX 2"),
                _flight(f"{start} 10:00", 100, token="fresh" if later else "original", number="FX 3"),
            ]}
        return {"other_flights": [
            _flight(f"{end} 10:00", 210 if token != "other" else 300, origin="JFK", destination="DFW"),
            _flight(f"{end} 19:00", 260, origin="JFK", destination="DFW"),
        ]}

    monkeypatch.setattr(serp, "_request_provider", quote)
    initial = asyncio.run(flight_graph.serve_conversation("Find round-trip flights", [], {}))
    assert initial["recommendation"]["itinerary"]["flight_numbers"] == ["FX 3"]
    later = True
    searches.clear()
    edited = asyncio.run(flight_graph.serve_conversation(
        "Keep the outbound. Show me later returns.", [], initial["trip_state"], initial["recommendation"],
    ))
    assert searches == [None, "fresh"]
    assert edited["travel_result"]["flights"][0]["departure_time"] == f"{start} 10:00"
    assert edited["travel_result"]["flights"][0]["return_flight"]["departure_time"] == f"{end} 19:00"
    assert "Same outbound" in edited["travel_result"]["notice"]
    assert "pinned_outbound" not in edited["trip_state"]["flight_timing"]


@pytest.mark.parametrize("failure", ["timeout", "transient"])
def test_roundtrip_failure_keeps_verified_fares_and_marks_partial(monkeypatch, flight_graph, failure):
    start = (date.today() + timedelta(days=30)).isoformat()
    end = (date.today() + timedelta(days=33)).isoformat()
    saved = TravelSearchArgs(search_type="flight_only", origin="DFW", destination="JFK",
                             start_date=start, end_date=end)
    monkeypatch.setattr(flight_graph, "_extract_travel_params", AsyncMock(return_value=saved))
    monkeypatch.setattr(serp, "RETURN_SEARCH_DEADLINE_SECONDS", 0.1)
    stalled_cancelled = False

    async def quote(query):
        nonlocal stalled_cancelled
        if query.get("departure_token") == "slow":
            if failure == "transient":
                raise serp.ProviderUnavailable("Fixture provider temporarily unavailable")
            try:
                await asyncio.Future()
            finally:
                stalled_cancelled = True
        if query.get("departure_token") == "quick":
            return {"best_flights": [_flight(f"{end} 12:00", 250, origin="JFK", destination="DFW")]}
        return {"best_flights": [
            _flight(f"{start} 09:00", 110, token="slow"),
            _flight(f"{start} 15:00", 150, token="quick"),
        ]}

    monkeypatch.setattr(serp, "_request_provider", quote)
    result = asyncio.run(flight_graph.serve_conversation("Find round-trip flights", [], {}))
    assert stalled_cancelled == (failure == "timeout")
    assert [flight["total_usd"] for flight in result["travel_result"]["flights"]] == [250]
    assert PARTIAL_RETURN_NOTICE in result["travel_result"]["notice"]
    assert PARTIAL_RETURN_NOTICE in result["response"]
