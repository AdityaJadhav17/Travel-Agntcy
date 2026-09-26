"""Credential-free regression tests; real integrations use scripts/smoke_test.py."""
import asyncio
import json
from datetime import date, timedelta
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, HumanMessage

from agents.travel import serpapi_tools as serp
from agents.travel.travel_logic import find_cheapest_plan
from agents.hotel.agent import HotelSearchAgent
from agents.flight.agent import FlightSearchAgent
from agents.activity.agent import ActivitySearchAgent
from agents.supervisors.travel.graph import tools
from agents.supervisors.travel.graph.graph import TravelGraph
from agents.supervisors.travel.graph.models import TravelSearchArgs
from agents.supervisors.travel import main


def run(awaitable):
    return asyncio.run(awaitable)


def test_hotel_currency_and_total():
    hotel = serp._parse_hotel({'name': 'Hotel', 'rate_per_night': {'lowest': 'US$104', 'extracted_lowest': 104}, 'total_rate': {'lowest': 'US$313', 'extracted_lowest': 313}}, '2026-10-24', '2026-10-27')
    assert hotel['price'] == 104
    assert hotel['total_price'] == 313
    assert hotel['nights'] == 3


def test_hotel_total_only_not_multiplied_twice():
    hotel = serp._parse_hotel({'total_rate': {'extracted_lowest': 600}}, '2026-10-24', '2026-10-27')
    assert hotel['price'] == 200
    assert hotel['total_price'] == 600


def test_unpriced_results_excluded():
    assert serp._parse_hotel({'name': 'Unknown price'}, '2026-10-24') is None
    assert serp._parse_flight({'flights': [{}]}) is None


def test_plan_compares_total_stay_cost():
    flights = [{'price': 200, 'arrival_time': '2026-10-24 12:00'}]
    hotels = [dict(name='A', price=100, total_price=400, rating=4), dict(name='B', price=110, total_price=330, rating=4)]
    plan = find_cheapest_plan(flights, hotels)
    assert plan['hotel']['name'] == 'B'
    assert plan['total_price'] == 530


def test_multiword_agent_requests():
    assert HotelSearchAgent()._parse_request('location:New York, NY check_in:2026-10-24 check_out:2026-10-27')['location'] == 'New York, NY'
    assert ActivitySearchAgent()._parse_request('location:New_York type:things_to_do')['location'] == 'New York'
    assert FlightSearchAgent()._parse_request('origin:DFW destination:JFK outbound:2026-10-24 type:oneway')['is_one_way']


def test_empty_results_are_json(monkeypatch):
    monkeypatch.setattr('agents.hotel.agent.search_hotels', AsyncMock(return_value=[]))
    result = json.loads(run(HotelSearchAgent().ainvoke('location:New York check_in:2026-10-24 check_out:2026-10-27')))
    assert result['status'] == 'success'
    assert result['hotels'] == []


def test_agent_error_is_not_empty_results(monkeypatch):
    monkeypatch.setattr(tools, '_search_hotels_internal', AsyncMock(return_value=json.dumps({'status':'error','message':'SerpAPI returned HTTP 401'})))
    with pytest.raises(tools.A2AAgentError, match='401'):
        run(tools.get_hotels_via_a2a('New York', '2026-10-24', '2026-10-27'))


def test_serpapi_error_does_not_leak_key(monkeypatch):
    request = httpx.Request('GET', 'https://serpapi.com/search?api_key=secret-test-key')
    response = httpx.Response(401, request=request)
    mock = AsyncMock()
    mock.get.side_effect = httpx.HTTPStatusError('secret-test-key', request=request, response=response)
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: mock)
    mock.__aenter__.return_value = mock
    with pytest.raises(RuntimeError) as exc:
        run(serp._request_search({}))
    assert '401' in str(exc.value)
    assert 'secret-test-key' not in str(exc.value)


def test_one_way_parameters(monkeypatch):
    request = AsyncMock(return_value={'best_flights': []})
    monkeypatch.setattr(serp, '_request_search', request)
    monkeypatch.setattr(serp, 'SERPAPI_API_KEY', 'test-only')
    run(serp.search_flights('dfw', 'jfk', '2026-10-24', include_return_flights=False))
    params = request.call_args.args[0]
    assert params['type'] == '2'
    assert params['departure_id'] == 'DFW'
    assert 'return_date' not in params


def test_roundtrip_uses_departure_token(monkeypatch):
    outbound = {'price': 200, 'departure_token': 'outbound-token', 'flights': [{'departure_airport': {'id':'DFW'}, 'arrival_airport': {'id':'JFK'}}]}
    inbound = {'price': 250, 'flights': [{'departure_airport': {'id':'JFK'}, 'arrival_airport': {'id':'DFW'}}]}
    request = AsyncMock(side_effect=[{'best_flights':[outbound]}, {'best_flights':[inbound]}])
    monkeypatch.setattr(serp, '_request_search', request)
    monkeypatch.setattr(serp, 'SERPAPI_API_KEY', 'test-only')
    result = run(serp.search_flights('DFW','JFK','2026-10-24','2026-10-27'))
    assert request.call_args_list[1].args[0]['departure_token'] == 'outbound-token'
    assert request.call_args_list[1].args[0]['type'] == '1'
    assert result[0]['price'] == 250
    assert result[0]['return_flight']['departure_code'] == 'JFK'


def test_reflection_waits_for_user():
    result = run(TravelGraph()._reflection_node({'messages': [HumanMessage(content='Plan a trip'), AIMessage(content='Which dates?')]}))
    assert result['next_node'] == '__end__'


def test_full_graph_and_api(monkeypatch):
    graph = TravelGraph()
    start = date.today() + timedelta(days=30)
    end = start + timedelta(days=3)
    graph.supervisor_llm = AsyncMock()  # Replace only the external LLM boundary below.
    from langchain_core.runnables import RunnableLambda
    graph.supervisor_llm = RunnableLambda(lambda _: AIMessage(content='travel_search'))
    graph.travel_search_llm = object()
    monkeypatch.setattr(graph, '_extract_travel_params', AsyncMock(return_value=TravelSearchArgs(origin='DFW', destination='JFK', destination_city='New York', start_date=str(start), end_date=str(end), has_all_params=True)))
    flight = AsyncMock(return_value=[{'price':200, 'airline':'Test airline', 'arrival_time':f'{start} 12:00'}])
    hotel = AsyncMock(return_value=[{'name':'Test hotel','price':100,'total_price':300,'rating':4}])
    activity = AsyncMock(return_value=[{'name':'Test museum','rating':4.5}])
    monkeypatch.setattr('agents.supervisors.travel.graph.graph.get_flights_via_a2a', flight)
    monkeypatch.setattr('agents.supervisors.travel.graph.graph.get_hotels_via_a2a', hotel)
    monkeypatch.setattr('agents.supervisors.travel.graph.graph.get_activities_via_a2a', activity)
    monkeypatch.setattr(main, 'travel_graph', graph)
    with TestClient(main.app) as client:
        response = client.post('/agent/prompt', json={'prompt':'Find flights and hotels from DFW to New York'})
    assert response.status_code == 200
    assert '$500.00' in response.json()['response']
    assert 'Test museum' in response.json()['response']
    assert response.json()['session_id']
    flight.assert_awaited_once()
    hotel.assert_awaited_once()
    activity.assert_awaited_once()


def test_api_validation_and_cors():
    with TestClient(main.app) as client:
        assert client.get('/health').json() == {'status':'ok'}
        for endpoint in ('/agent/prompt', '/agent/prompt/stream'):
            assert client.post(endpoint, json={'prompt':'   '}).status_code == 422
        response = client.options('/agent/prompt', headers={'Origin':'http://localhost:3000','Access-Control-Request-Method':'POST'})
        assert response.status_code == 200
        assert response.headers['access-control-allow-origin'] == 'http://localhost:3000'


def test_ndjson_stream(monkeypatch):
    monkeypatch.setattr(main.travel_graph, 'serve', AsyncMock(return_value='Result one'))
    with TestClient(main.app) as client:
        response = client.post('/agent/prompt/stream', json={'prompt':'trip'})
    lines = [json.loads(line) for line in response.text.splitlines()]
    assert [line['type'] for line in lines] == ['status', 'text', 'done']
    assert lines[-1]['result']['response'] == 'Result one'
    assert lines[-1]['result']['session_id']
