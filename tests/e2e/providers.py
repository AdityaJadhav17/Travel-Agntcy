"""Deterministic HTTP substitute for SerpAPI, only in the isolated CI stack."""

from datetime import date
import time

from fastapi import FastAPI, Request, HTTPException

app = FastAPI()
transient_queries = set()
request_counts = {"google_flights": 0, "google_hotels": 0, "other": 0}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/__eval/metrics")
def eval_metrics():
    return {"provider_calls": dict(request_counts)}


@app.get("/search")
def search(request: Request):
    params = request.query_params
    engine = params.get("engine")
    request_counts[engine if engine in request_counts else "other"] += 1
    if "failure" in params.get("q", "").lower():
        raise HTTPException(503, "Test provider unavailable")
    if engine == "google_hotels":
        query = params.get("q", "").lower()
        if query.startswith("transient-") and query not in transient_queries:
            transient_queries.add(query)
            raise HTTPException(503, "Test hotel provider temporarily unavailable")
        if query.startswith("slow-"):
            time.sleep(3)
    if engine == "google_flights":
        adults, children = int(params["adults"]), int(params["children"])
        inbound = bool(params.get("departure_token"))
        origin, destination = params["departure_id"], params["arrival_id"]
        day = params["return_date"] if inbound else params["outbound_date"]
        if inbound:
            origin, destination = destination, origin
        flight = {
            "airline": "Fixture Air",
            "departure_airport": {"id": origin, "time": f"{day} 10:00"},
            "arrival_airport": {"id": destination, "time": f"{day} 13:00"},
        }
        return {"best_flights": [{"price": adults * 240 + children * 150, "departure_token": "fixture-outbound", "total_duration": 180, "flights": [flight]}]}
    if engine == "google_hotels":
        adults, children = int(params["adults"]), int(params["children"])
        ages = params.get("children_ages", "").split(",") if children else []
        if len(ages) != children or any(not 1 <= int(age) <= 17 for age in ages):
            raise HTTPException(400, "Missing or invalid child ages")
        nights = (date.fromisoformat(params["check_out_date"]) - date.fromisoformat(params["check_in_date"])).days
        nightly = 100 + (adults - 1) * 30 + children * 20
        return {"properties": [{
            "name": "Fixture Central Hotel", "overall_rating": 4.6,
            "check_in_time": "3:00 PM", "check_out_time": "11:00 AM",
            "rate_per_night": {"extracted_lowest": nightly},
            "total_rate": {"extracted_lowest": nights * nightly},
        }, {
            "name": "Fixture Riverside Hotel", "overall_rating": 4.4,
            "check_in_time": "3:00 PM", "check_out_time": "11:00 AM",
            "rate_per_night": {"extracted_lowest": nightly + 25},
            "total_rate": {"extracted_lowest": nights * (nightly + 25)},
        }]}
    return {"local_results": [{"title": "Fixture City Museum", "rating": 4.8, "reviews": 123, "type": "Museum"}]}
