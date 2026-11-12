from datetime import date, timedelta

from agents.supervisors.travel.graph.graph import TravelGraph
from agents.supervisors.travel.graph.models import TravelSearchArgs
from agents.supervisors.travel.graph.presentation_selection import (
    explicit_requested_count,
    select_for_presentation,
)


def test_count_extraction_is_category_scoped_and_does_not_read_party_or_stay_counts():
    assert explicit_requested_count("show three activities", "activity") == (3, False)
    assert explicit_requested_count("show me 3 hotel options", "hotel") == (3, False)
    assert explicit_requested_count("one hotel room for three nights", "hotel") == (None, False)
    assert explicit_requested_count("find a few activities", "activity") == (None, True)
    assert explicit_requested_count("show 0 flights", "flight") == (None, True)
    assert explicit_requested_count("show -1 flights", "flight") == (None, True)
    assert explicit_requested_count("show 2.5 activities", "activity") == (None, True)


def test_presentation_selection_is_bounded_deduplicated_and_stable():
    items = [{"name": "A"}, {"name": "A"}, {"name": "B"}, {"name": "C"}]
    selected, notice = select_for_presentation(items, 3)
    assert [item["name"] for item in selected] == ["A", "B", "C"]
    assert notice == ""
    selected, notice = select_for_presentation(items, 8)
    assert [item["name"] for item in selected] == ["A", "B", "C"]
    assert "up to 5" in notice and "Only 3" in notice


def test_explicit_scope_exclusion_and_followup_preference_are_persisted():
    graph = TravelGraph()
    saved = {"search_type": "full_trip", "include_activities": True,
             "activity_result_count": 3, "origin": "DFW", "destination": "JFK"}
    params = TravelSearchArgs.model_validate(saved)
    scoped = graph._apply_explicit_scope(params, "Flights and hotels only, no activities", saved)
    assert scoped.search_type == "full_trip"
    assert scoped.include_activities is False
    assert scoped.activity_result_count == 3

    params = TravelSearchArgs.model_validate(saved)
    scoped = graph._apply_explicit_scope(params, "add activities", saved)
    assert scoped.search_type == "full_trip"
    assert scoped.include_activities is True

    params = TravelSearchArgs.model_validate(saved)
    scoped = graph._apply_explicit_scope(params, "activities only; no flights or hotels", saved)
    assert scoped.search_type == "activity_only"

    saved["accommodation_type"] = "hotel"
    saved["private_room_required"] = True
    params = TravelSearchArgs.model_validate(saved)
    scoped = graph._apply_explicit_scope(params, "remove the private room requirement", saved)
    assert scoped.accommodation_type == "hotel"
    assert scoped.private_room_required is False


def test_unsupported_flight_and_activity_combination_clarifies():
    graph = TravelGraph()
    params = TravelSearchArgs(origin="DFW", destination="JFK", start_date="2030-06-01")
    scoped = graph._apply_explicit_scope(params, "flights and activities only", {})
    assert scoped.clarification_question
    assert "Which search" in scoped.clarification_question


def test_excluded_activities_are_not_fetched_or_streamed(monkeypatch):
    import asyncio
    from unittest.mock import AsyncMock
    import agents.supervisors.travel.graph.graph as graph_module

    start = date.today() + timedelta(days=30)
    params = TravelSearchArgs(
        origin="DFW", destination="JFK", destination_city="New York",
        start_date=start.isoformat(), end_date=(start + timedelta(days=2)).isoformat(),
        include_activities=False, is_one_way=True,
    )
    flight = {"airline": "Fixture Air", "price": 100, "currency": "USD",
              "departure_time": f"{start} 09:00", "arrival_time": f"{start} 12:00"}
    hotel = {"name": "Fixture Hotel", "price": 100, "total_price": 200,
             "currency": "USD", "check_in_date": start.isoformat(),
             "check_out_date": (start + timedelta(days=2)).isoformat(),
             "check_in_time": "08:00 AM", "overall_rating": 4.5, "location_rating": 4.5}
    activity_search = AsyncMock(return_value=[])
    emits = []
    monkeypatch.setattr(graph_module, "get_activities_via_a2a", activity_search)
    monkeypatch.setattr(graph_module, "emit", lambda event, **payload: emits.append((event, payload)))

    result = asyncio.run(TravelGraph()._complete_full_trip(params, [flight], [hotel],
                                                           (start + timedelta(days=2)).isoformat(),
                                                           "New York"))
    assert not activity_search.await_count
    assert not any(payload.get("component") == "activities" for _, payload in emits)
    assert result["travel_result"]["activities"] == []
    assert "Things to Do" not in result["full_response"]


def test_date_validation_ignores_dates_from_inactive_search_categories():
    graph = TravelGraph()
    future = date.today() + timedelta(days=40)
    stale = (date.today() - timedelta(days=10)).isoformat()
    hotel_only = TravelSearchArgs(
        search_type="hotel_only", location="Paris", start_date=stale, end_date=stale,
        hotel_check_in_date=future.isoformat(),
        hotel_check_out_date=(future + timedelta(days=3)).isoformat(),
    )
    assert graph._validate_dates(hotel_only) == ""

    flight_only = TravelSearchArgs(
        search_type="flight_only", origin="DFW", destination="JFK",
        start_date=future.isoformat(), end_date=None,
        hotel_check_in_date=stale, hotel_check_out_date=stale,
    )
    assert graph._validate_dates(flight_only) == ""

    legacy_hotel = TravelSearchArgs(
        search_type="hotel_only", location="Paris", start_date=stale,
        end_date=(date.today() - timedelta(days=8)).isoformat(),
    )
    assert "past" in graph._validate_dates(legacy_hotel)

    trip_missing_flight_date = TravelSearchArgs(
        search_type="full_trip", origin="DFW", destination="JFK",
        hotel_check_in_date=future.isoformat(),
        hotel_check_out_date=(future + timedelta(days=3)).isoformat(), is_one_way=True,
    )
    assert graph._missing_details(trip_missing_flight_date) == "What date would you like to leave?"


def test_one_way_full_trip_requires_hotel_checkout_separate_from_flight_dates():
    graph = TravelGraph()
    params = TravelSearchArgs(
        search_type="full_trip", origin="DFW", destination="JFK",
        start_date="2027-10-24", is_one_way=True,
    )
    assert "check-out" in graph._missing_details(params)

    # A supplied end date remains a valid legacy hotel checkout fallback.
    params.end_date = "2027-10-25"
    assert graph._missing_details(params) is None

    params.end_date = None
    # An explicit hotel checkout is independent of the one-way flight dates.
    params.hotel_check_in_date = "2027-10-25"
    params.hotel_check_out_date = "2027-10-28"
    assert graph._missing_details(params) is None


def test_all_contradictory_hotels_keep_flights_and_allow_hotel_retry(monkeypatch):
    import asyncio
    from unittest.mock import AsyncMock
    import agents.supervisors.travel.graph.graph as graph_module

    departure = date.today() + timedelta(days=30)
    params = TravelSearchArgs(
        origin="DFW", destination="JFK", destination_city="New York",
        start_date=departure.isoformat(), end_date=(departure + timedelta(days=2)).isoformat(),
        accommodation_type="hotel",
    )
    flight = {"airline": "Fixture Air", "price": 100, "currency": "USD",
              "departure_time": f"{departure} 09:00", "arrival_time": f"{departure} 12:00"}
    hostel = {"name": "Fixture Hostel", "price": 100, "total_price": 200,
              "property_type": "hostel", "accommodation_evidence_source": "provider"}
    monkeypatch.setattr(graph_module, "get_flights_via_a2a", AsyncMock(return_value=[flight]))
    monkeypatch.setattr(graph_module, "get_hotels_via_a2a", AsyncMock(return_value=[hostel]))

    result = asyncio.run(TravelGraph()._handle_full_trip_search(params))

    assert "contradicted your accommodation requirements" in result["full_response"]
    assert result["partial_search"] is not None
    assert result["retry_hotels"] is True
    assert result["partial_search"]["reason"] == "empty"
    assert len(result["travel_result"]["flights"]) == 1
    assert result["travel_result"]["flights"][0]["airline"] == "Fixture Air"


def test_hotel_formatters_show_quoted_total_separately_from_nightly_rate():
    graph = TravelGraph()
    check_in = date.today() + timedelta(days=30)
    check_out = check_in + timedelta(days=3)
    params = TravelSearchArgs(
        search_type="full_trip", origin="DFW", destination="JFK",
        destination_city="New York", start_date=check_in.isoformat(),
        end_date=check_out.isoformat(), hotel_check_in_date=check_in.isoformat(),
        hotel_check_out_date=check_out.isoformat(), is_one_way=True,
    )
    hotel = {"name": "Fixture Hotel", "price": 90, "total_price": 269,
             "currency": "USD", "check_in_date": check_in.isoformat(),
             "check_out_date": check_out.isoformat()}
    flight = {"airline": "Fixture Air", "price": 100, "currency": "USD",
              "departure_time": f"{check_in} 09:00", "arrival_time": f"{check_in} 12:00"}

    hotel_only = graph._format_hotels_only([hotel], "New York", params)
    full_trip = graph._format_travel_plan(
        {"flight": flight, "hotel": hotel}, params, hotel_checkout_date=check_out.isoformat())

    for response in (hotel_only, full_trip):
        plain_text = response.replace("**", "")
        assert "$90.00/night; quoted stay total $269.00 for 3 nights" in plain_text
        assert "× 3 =" not in response


def test_removing_private_room_requirement_keeps_hotel_category_and_dates():
    graph = TravelGraph()
    check_in = (date.today() + timedelta(days=20)).isoformat()
    check_out = (date.today() + timedelta(days=22)).isoformat()
    saved = {
        "search_type": "hotel_only", "accommodation_type": "hotel",
        "private_room_required": True, "hotel_check_in_date": check_in,
        "hotel_check_out_date": check_out,
    }
    params = TravelSearchArgs.model_validate(saved)
    result = graph._apply_explicit_scope(params, "remove the private room requirement", saved)
    assert result.private_room_required is False
    assert result.accommodation_type == "hotel"
    assert result.hotel_check_in_date == check_in
    assert result.hotel_check_out_date == check_out

    params = TravelSearchArgs.model_validate(saved)
    result = graph._apply_explicit_scope(params, "allow hostels", saved)
    assert result.accommodation_type == "any"
    assert result.private_room_required is True


def test_unpairable_trip_keeps_separate_flight_and_hotel_cards(monkeypatch):
    import asyncio
    from unittest.mock import AsyncMock
    import agents.supervisors.travel.graph.graph as graph_module

    check_in = date.today() + timedelta(days=30)
    check_out = check_in + timedelta(days=2)
    params = TravelSearchArgs(
        origin="DFW", destination="JFK", destination_city="New York",
        start_date=check_in.isoformat(), end_date=check_out.isoformat(), is_one_way=True,
        include_activities=False,
        hotel_check_in_date=check_in.isoformat(), hotel_check_out_date=check_out.isoformat(),
    )
    flight = {"airline": "Fixture Air", "price": 100, "currency": "USD",
              "departure_time": f"{check_in} 09:00", "arrival_time": f"{check_out} 11:00"}
    hotel = {"name": "Fixture Hotel", "price": 100, "total_price": 200,
             "currency": "USD", "check_in_date": check_in.isoformat(),
             "check_out_date": check_out.isoformat(), "check_out_time": "11:00 AM"}
    activity_search = AsyncMock(return_value=[])
    monkeypatch.setattr(graph_module, "get_activities_via_a2a", activity_search)
    result = asyncio.run(TravelGraph()._complete_full_trip(
        params, [flight], [hotel], check_out.isoformat(), "New York"))
    cards = result["travel_result"]
    assert cards["kind"] == "full_trip"
    assert cards["total_usd"] is None
    assert len(cards["flights"]) == len(cards["hotels"]) == 1
    assert cards["hotel_check_in_date"] == check_in.isoformat()
    assert cards["hotel_check_out_date"] == check_out.isoformat()
    assert activity_search.await_count == 0


def test_implicit_buffer_crossing_midnight_asks_before_hotel_search(monkeypatch):
    import asyncio
    from unittest.mock import AsyncMock
    import agents.supervisors.travel.graph.graph as graph_module

    departure = date.today() + timedelta(days=30)
    params = TravelSearchArgs(
        origin="DFW", destination="JFK", destination_city="New York",
        start_date=departure.isoformat(), end_date=(departure + timedelta(days=3)).isoformat(),
    )
    flight = {"airline": "Fixture Air", "price": 100, "currency": "USD",
              "departure_time": f"{departure} 19:00", "arrival_time": f"{departure} 22:30"}
    flights = AsyncMock(return_value=[flight])
    hotels = AsyncMock(return_value=[])
    monkeypatch.setattr(graph_module, "get_flights_via_a2a", flights)
    monkeypatch.setattr(graph_module, "get_hotels_via_a2a", hotels)
    result = asyncio.run(TravelGraph()._handle_full_trip_search(params))
    assert "What hotel check-in and check-out dates" in result["full_response"]
    assert hotels.await_count == 0

