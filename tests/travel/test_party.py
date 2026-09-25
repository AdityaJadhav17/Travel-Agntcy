"""Traveler constraints must reach providers and never silently fall back."""

import asyncio
import json
from unittest.mock import AsyncMock

import pytest
from langchain_core.messages import HumanMessage
from pydantic import ValidationError

from agents.travel.party import TravelParty, party_from_message
from agents.travel import serpapi_tools as serp
from agents.flight.agent import FlightSearchAgent
from agents.hotel.agent import HotelSearchAgent
from agents.supervisors.travel.graph.graph import TravelGraph
from agents.supervisors.travel.graph.models import TravelSearchArgs
from agents.supervisors.travel.graph import tools


@pytest.mark.parametrize("updates", [
    {"adults": 0}, {"adults": -1}, {"adults": True}, {"adults": 1.5},
    {"children": -1}, {"children": 9}, {"rooms": 0}, {"rooms": 10},
    {"children_ages": [-1]}, {"children_ages": [18]}, {"children_ages": [True]},
])
def test_reject_invalid_party(updates):
    with pytest.raises(ValidationError):
        TravelParty(**updates)


@pytest.mark.parametrize("updates, kind, expected", [
    ({"adults": 9, "children": 1, "children_ages": [5]}, "flight_only", "up to 9"),
    ({"children": 2, "children_ages": [5]}, "full_trip", "ages"),
    ({"children": 0, "children_ages": [5]}, "hotel_only", "correct the child count"),
    ({"rooms": 2}, "full_trip", "supports one room only"),
    ({"children": 1, "children_ages": [1]}, "flight_only", "Infant"),
])
def test_clarify_before_provider_calls_and_preserve_requested_values(monkeypatch, updates, kind, expected):
    trip = TravelSearchArgs(search_type=kind, **updates)
    graph = TravelGraph()
    graph.travel_search_llm = object()
    monkeypatch.setattr(graph, "_extract_travel_params", AsyncMock(return_value=trip))
    flight, hotel = AsyncMock(), AsyncMock()
    monkeypatch.setattr("agents.supervisors.travel.graph.graph.get_flights_via_a2a", flight)
    monkeypatch.setattr("agents.supervisors.travel.graph.graph.get_hotels_via_a2a", hotel)
    result = asyncio.run(graph._travel_search_node({"messages": [HumanMessage(content="Family trip")]}))
    assert expected in result["messages"][0].content
    for key, value in updates.items():
        assert result["search_params"][key] == value
    flight.assert_not_awaited()
    hotel.assert_not_awaited()


def test_provider_age_categories_and_hotel_infant_convention():
    party = TravelParty(adults=2, children=3, children_ages=[2, 11, 17])
    assert party.flight_parameters() == {"adults": 3, "children": 2}
    assert party.hotel_parameters() == {"adults": 2, "children": 3, "children_ages": "2,11,17"}
    assert TravelParty(children=1, children_ages=[0]).hotel_parameters()["children_ages"] == "1"
    assert TravelParty(rooms=2).question("flight_only") is None
    assert TravelParty(children=1).question("activity_only") is None


def test_round_trip_party_reaches_both_requests_without_multiplying_quote(monkeypatch):
    party = TravelParty(adults=2, children=1, children_ages=[7])
    outbound = {"price": 630, "departure_token": "selected-outbound", "flights": [{"departure_airport": {"id": "DFW"}, "arrival_airport": {"id": "JFK"}}]}
    inbound = {**outbound, "price": 680}
    request = AsyncMock(side_effect=[{"best_flights": [outbound]}, {"best_flights": [inbound]}])
    monkeypatch.setattr(serp, "_request_search", request)
    monkeypatch.setattr(serp, "SERPAPI_API_KEY", "test")
    results = asyncio.run(serp.search_flights("DFW", "JFK", "2027-01-01", "2027-01-04", party=party))
    for call in request.call_args_list:
        assert call.args[0]["adults"] == 2
        assert call.args[0]["children"] == 1
    assert request.call_args_list[1].args[0]["departure_token"] == "selected-outbound"
    assert results[0]["price"] == 680
    assert results[0]["party"] == party.model_dump()


def test_hotel_occupancy_reaches_provider_and_total_is_not_multiplied(monkeypatch):
    party = TravelParty(adults=2, children=1, children_ages=[7])
    request = AsyncMock(return_value={"properties": [{"name": "Family Hotel", "rate_per_night": {"extracted_lowest": 150}, "total_rate": {"extracted_lowest": 450}}]})
    monkeypatch.setattr(serp, "_request_search", request)
    monkeypatch.setattr(serp, "SERPAPI_API_KEY", "test")
    results = asyncio.run(serp.search_hotels("New York", "2027-01-01", "2027-01-04", party=party))
    sent = request.call_args.args[0]
    assert (sent["adults"], sent["children"], sent["children_ages"]) == (2, 1, "7")
    assert "rooms" not in sent
    assert results[0]["total_price"] == 450
    assert results[0]["party"] == party.model_dump()
    request.reset_mock()
    with pytest.raises(ValueError, match="supports one room"):
        asyncio.run(serp.search_hotels("New York", "2027-01-01", "2027-01-04", party=TravelParty(rooms=2)))
    request.assert_not_awaited()


@pytest.mark.parametrize("kind", ["flight", "hotel"])
def test_party_roundtrips_through_real_agent_parser(monkeypatch, kind):
    party = TravelParty(adults=2, children=1, children_ages=[7])
    search = AsyncMock(return_value=[])
    monkeypatch.setattr(f"agents.{kind}.agent.search_{kind}s", search)
    agent = FlightSearchAgent() if kind == "flight" else HotelSearchAgent()

    async def send(card, message):
        assert party_from_message(message) == party
        return await agent.ainvoke(message)

    monkeypatch.setattr(tools, "_send_a2a_message", send)
    if kind == "flight":
        asyncio.run(tools.get_flights_via_a2a("DFW", "JFK", "2027-01-01", is_one_way=True, party=party))
    else:
        asyncio.run(tools.get_hotels_via_a2a("New York", "2027-01-01", "2027-01-04", party=party))
    assert search.await_args.kwargs["party"] == party
    if kind == "hotel":
        assert search.await_args.kwargs["location"] == "New York"


def test_a2a_quote_for_wrong_party_is_rejected(monkeypatch):
    response = {"status": "success", "flights": [{"price": 100, "party": TravelParty().model_dump()}]}
    monkeypatch.setattr(tools, "_send_a2a_message", AsyncMock(return_value=json.dumps(response)))
    with pytest.raises(tools.A2AAgentError, match="did not confirm"):
        asyncio.run(tools.get_flights_via_a2a("DFW", "JFK", "2027-01-01", is_one_way=True, party=TravelParty(adults=2)))


def test_invalid_extraction_keeps_saved_trip(monkeypatch):
    graph = TravelGraph()
    graph.travel_search_llm = object()

    async def invalid(_):
        return TravelSearchArgs(adults=-1)

    monkeypatch.setattr(graph, "_extract_travel_params", invalid)
    result = asyncio.run(graph._travel_search_node({"messages": [HumanMessage(content="invalid")], "search_params": {"adults": 2}}))
    assert "whole-number counts" in result["messages"][0].content
    assert "search_params" not in result  # LangGraph keeps the existing state.
