"""Compare normal and preview searches on the isolated fixture stack."""

from datetime import date, timedelta
import json
import os
import urllib.request
from uuid import uuid4


API = "http://localhost:8000"
PROVIDER = "http://providers:9000"


def request(url, payload=None):
    body = json.dumps(payload).encode() if payload is not None else None
    return urllib.request.urlopen(urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"},
    ), timeout=20)


def calls():
    with request(f"{PROVIDER}/__eval/metrics") as response:
        return json.load(response)["provider_calls"]


def gate(action):
    with request(f"{PROVIDER}/__eval/preview-return/{action}", {}) as response:
        assert json.load(response)["released"] == (action == "release")


def main():
    assert os.environ.get("SERPAPI_BASE_URL") == f"{PROVIDER}/search"
    assert os.environ.get("LLM_MODEL") == "ci-no-external-model"
    assert os.environ.get("TRAVEL_FLIGHT_PREVIEW_ENABLED") == "true"
    start = date.today() + timedelta(days=30)
    end = start + timedelta(days=3)

    def turn(endpoint, city="New York", constraints=""):
        return request(f"{API}/agent/prompt{endpoint}", {
            "prompt": f"Flights only from Dallas to {city} {start} to {end} {constraints}".strip(),
            "conversation_id": str(uuid4()), "request_id": str(uuid4()),
        })

    before = calls()
    with turn("") as response:
        baseline = json.load(response)["travel_result"]
    after_baseline = calls()
    assert baseline["kind"] == "flight_only" and baseline["flights"][0]["return_flight"]

    gate("hold")
    try:
        with turn("/stream") as response:
            for line in response:
                event = json.loads(line)
                assert event["type"] not in {"done", "error", "result"}
                if event["type"] == "outbound_preview":
                    [flight] = event["flights"]
                    assert set(flight) == {"airline", "departure_time", "arrival_time", "stops"}
                    assert flight["airline"] == "Fixture Air"
                    break
            else:
                raise AssertionError("Missing outbound preview")

            gate("release")
            terminals = [event for line in response if (event := json.loads(line))["type"] == "done"]
        [terminal] = terminals
    finally:
        gate("release")

    after_preview = calls()
    assert after_baseline["google_flights"] - before["google_flights"] == 2
    assert after_preview["google_flights"] - after_baseline["google_flights"] == 2
    final = terminal["result"]["travel_result"]
    assert final["kind"] == baseline["kind"] and final["flights"] == baseline["flights"]
    assert final["total_usd"] == baseline["total_usd"]
    print("Preview arrived before return release. Both paths made two provider calls and returned identical flight cards and prices.")

    if os.environ.get("TRAVEL_VERIFIED_FLIGHT_PREVIEW_ENABLED") == "true":
        check_verified_return(turn)


def check_verified_return(turn):
    before = calls()["google_flights"]
    with turn("", "Chicago") as response:
        baseline = json.load(response)["travel_result"]
    after_baseline = calls()["google_flights"]
    assert [flight["total_usd"] for flight in baseline["flights"]] == [200, 275]

    gate("hold")
    try:
        with turn("/stream", "Chicago") as response:
            for line in response:
                event = json.loads(line)
                assert event["type"] not in {"done", "error", "result"}
                if event["type"] == "verified_flight_preview":
                    early = event["flight"]
                    assert early["total_usd"] == 275
                    assert set(early) == {"outbound", "returned", "total_usd"}
                    assert early["outbound"]["departure_time"].endswith("14:00")
                    assert all(set(leg) == {"airline", "departure_time", "arrival_time", "stops"}
                               for leg in (early["outbound"], early["returned"]))
                    break
            else:
                raise AssertionError("Missing verified return preview")
            gate("release")
            events = [json.loads(line) for line in response]
        assert not any(event["type"] == "verified_flight_preview" for event in events)
        [final] = [event["result"]["travel_result"] for event in events if event["type"] == "done"]
    finally:
        gate("release")

    assert final["flights"] == baseline["flights"]
    assert calls()["google_flights"] - after_baseline == after_baseline - before == 3
    print("The checked $275 fare arrived while the cheaper return was blocked. Both paths made three calls and ranked both final quotes identically.")

    with turn("/stream", "Chicago", "budget USD 225") as response:
        events = [json.loads(line) for line in response]
    assert not any(event["type"] == "verified_flight_preview" for event in events)
    [budget_trip] = [event["result"] for event in events if event["type"] == "done"]
    assert budget_trip["budget_assessment"]["status"] == "within"
    assert [flight["total_usd"] for flight in budget_trip["travel_result"]["flights"]] == [200]
    print("Budgeted search skipped the early checked card and returned only the eligible quote.")


if __name__ == "__main__":
    main()
