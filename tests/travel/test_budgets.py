"""Budget decisions must be grounded in complete comparable quotes."""

import asyncio
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError
from langchain_core.messages import HumanMessage

from agents.supervisors.travel.graph.models import TravelSearchArgs
from agents.supervisors.travel.graph.graph import TravelGraph
from agents.supervisors.travel.graph.budgets import budget_question, filter_quotes, money, quote_total


def params(**updates):
    start = date.today() + timedelta(days=30)
    return TravelSearchArgs(**{
        "origin": "DFW", "destination": "JFK", "destination_city": "New York",
        "start_date": str(start), "end_date": str(start + timedelta(days=3)),
        "budget_amount": 500, "budget_currency": "USD", "budget_scope": "quoted_total", **updates,
    })


@pytest.mark.parametrize('amount', [0, -1, float('inf'), float('nan')])
def test_invalid_budget_not_accepted(amount):
    with pytest.raises(ValidationError):
        params(budget_amount=amount)


@pytest.mark.parametrize('updates, expected', [
    ({"budget_currency": None}, 'Which currency'),
    ({"budget_currency": 'EUR'}, 'cannot convert'),
    ({"budget_scope": None}, 'quoted flight'),
    ({"budget_scope": 'per_night'}, 'nightly'),
    ({"budget_scope": 'per_person'}, 'per-person'),
    ({"budget_scope": 'all_in'}, 'all-in'),
    ({"search_type": 'activity_only'}, 'cannot check'),
])
def test_unsupported_budget_asks_before_any_search(monkeypatch, updates, expected):
    graph = TravelGraph()
    graph.travel_search_llm = object()
    monkeypatch.setattr(graph, '_extract_travel_params', AsyncMock(return_value=params(**updates)))
    search = AsyncMock()
    monkeypatch.setattr(graph, '_handle_full_trip_search', search)
    result = asyncio.run(graph._travel_search_node({"messages": [HumanMessage(content='Budget please')]}))
    assert expected in result['messages'][0].content
    search.assert_not_awaited()
    assert result['search_params']['budget_amount'] == 500


def test_full_stay_totals_currency_and_decimal_boundary():
    trip = params(budget_amount=300)
    cheap = {"price": 100, "currency": "USD"}
    expensive = {"price": 90, "total_price": 350, "currency": "USD"}
    filtered, summary = filter_quotes([cheap, expensive, {"price": 1}, {"price": 1, "currency": "EUR"}], 'hotel', trip)
    assert filtered == [cheap]
    assert summary['quoted_total'] == 300
    assert summary['status'] == 'within'
    assert quote_total(expensive, 'hotel', trip) == Decimal('350.00')
    assert money(0.1 + 0.2) == Decimal('0.30')
    assert quote_total({"price": float('nan'), "currency": "USD"}, 'flight', trip) is None
    assert quote_total({"price": 1, "total_price": 0, "currency": "USD"}, 'hotel', trip) is None
    assert budget_question(params(budget_amount=None)) is None


@pytest.mark.parametrize('value', [None, True, 0, -1, 'invalid', float('inf'), '0.001'])
def test_invalid_quote_values_cannot_be_free_deals(value):
    assert money(value) is None


def test_incomplete_hotel_stay_cannot_be_estimated():
    assert quote_total({"price": 100, "currency": "USD"}, 'hotel', params(end_date=None)) is None
    assert quote_total({"price": 100, "currency": "USD"}, 'hotel', params(end_date='2020-01-01')) is None
    assert 'at least' in budget_question(params(budget_amount=0.001))


@pytest.mark.parametrize('kind,handler', [('flight', '_handle_flight_only_search'), ('hotel', '_handle_hotel_only_search')])
def test_only_affordable_options_reach_renderer(monkeypatch, kind, handler):
    trip = params(search_type=f'{kind}_only', budget_amount=300)
    quotes = [{"name": "Affordable", "airline": "Affordable", "price": 100, "currency": "USD"}, {"name": "Expensive", "airline": "Expensive", "price": 900, "currency": "USD"}]
    monkeypatch.setattr(f'agents.supervisors.travel.graph.graph.get_{kind}s_via_a2a', AsyncMock(return_value=quotes))
    result = asyncio.run(getattr(TravelGraph(), handler)(trip))
    assert result['budget_assessment']['status'] == 'within'
    assert 'Affordable' in result['full_response']
    assert 'Expensive' not in result['full_response']


@pytest.mark.parametrize('limit,status', [(500, 'within'), (499.99, 'over')])
def test_full_trip_budget_matches_full_stay_and_skips_unaffordable_activity_work(monkeypatch, limit, status):
    trip = params(budget_amount=limit, is_one_way=True)
    flight = {"price": 200, "currency": "USD", "arrival_time": f'{trip.start_date} 12:00'}
    hotel = {"name": "Test hotel", "price": 100, "currency": "USD", "rating": 4}
    monkeypatch.setattr('agents.supervisors.travel.graph.graph.get_flights_via_a2a', AsyncMock(return_value=[flight]))
    monkeypatch.setattr('agents.supervisors.travel.graph.graph.get_hotels_via_a2a', AsyncMock(return_value=[hotel]))
    activities = AsyncMock(return_value=[])
    monkeypatch.setattr('agents.supervisors.travel.graph.graph.get_activities_via_a2a', activities)
    result = asyncio.run(TravelGraph()._handle_full_trip_search(trip))
    assert result['budget_assessment']['status'] == status
    assert result['budget_assessment']['quoted_total'] == 500
    assert 'unquoted fees are excluded' in result['full_response']
    if status == 'within':
        assert '3 nights' in result['full_response']
        assert 'Total Cost: $500.00' in result['full_response']
        activities.assert_awaited_once()
    else:
        assert 'USD 0.01 over' in result['full_response']
        assert 'Hotel Details' not in result['full_response']
        activities.assert_not_awaited()


def test_incomplete_or_foreign_prices_do_not_pass_as_affordable(monkeypatch):
    trip = params()
    monkeypatch.setattr('agents.supervisors.travel.graph.graph.get_flights_via_a2a', AsyncMock(return_value=[{"price": 1, "currency": "EUR"}]))
    monkeypatch.setattr('agents.supervisors.travel.graph.graph.get_hotels_via_a2a', AsyncMock(return_value=[{"price": 1, "currency": "USD"}]))
    result = asyncio.run(TravelGraph()._handle_full_trip_search(trip))
    assert result['budget_assessment']['status'] == 'unknown'
    assert result['budget_assessment']['quoted_total'] is None
    assert 'Within quoted-cost budget' not in result['full_response']
