"""Deterministic HTTP substitute for SerpAPI, only in the isolated CI stack."""

from datetime import date

from fastapi import FastAPI, Request, HTTPException

app = FastAPI()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/search")
def search(request: Request):
    params = request.query_params
    engine = params.get("engine")
    if "failure" in params.get("q", "").lower():
        raise HTTPException(503, "Test provider unavailable")
    if engine == "google_flights":
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
        return {"best_flights": [{"price": 240, "departure_token": "fixture-outbound", "total_duration": 180, "flights": [flight]}]}
    if engine == "google_hotels":
        nights = (date.fromisoformat(params["check_out_date"]) - date.fromisoformat(params["check_in_date"])).days
        return {"properties": [{
            "name": "Fixture Central Hotel", "overall_rating": 4.6,
            "check_in_time": "3:00 PM", "check_out_time": "11:00 AM",
            "rate_per_night": {"extracted_lowest": 100},
            "total_rate": {"extracted_lowest": nights * 100},
        }]}
    return {"local_results": [{"title": "Fixture City Museum", "rating": 4.8, "reviews": 123, "type": "Museum"}]}
