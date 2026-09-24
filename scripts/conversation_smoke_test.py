"""Live model test of short replies/corrections, without a priced provider search.

Run in the supervisor: uv run --no-sync python scripts/conversation_smoke_test.py
"""

import json
from urllib.request import Request, urlopen
from uuid import uuid4


def main():
    conversation_id = str(uuid4())
    base = "http://localhost:8000"

    def send(prompt):
        payload = json.dumps({"prompt": prompt, "conversation_id": conversation_id, "request_id": str(uuid4())}).encode()
        request = Request(base + "/agent/prompt", data=payload, headers={"Content-Type": "application/json"})
        with urlopen(request, timeout=120) as response:
            return json.load(response)

    try:
        first = send("Plan a trip to New York.")
        assert first["trip_state"]["destination"] in ("JFK", "NYC", "EWR", "LGA")
        second = send("Dallas.")
        assert second["trip_state"]["origin"] == "DFW", second["trip_state"]
        assert second["trip_state"]["destination"] == first["trip_state"]["destination"]
        third = send("Actually Boston instead, keeping Dallas as my departure city.")
        assert third["trip_state"]["destination"] == "BOS", third["trip_state"]
        assert third["trip_state"]["origin"] == "DFW"
        assert not third["trip_state"]["start_date"]
        print("Live three-turn clarification and destination correction passed.")
    finally:
        with urlopen(Request(f"{base}/conversations/{conversation_id}", method="DELETE"), timeout=15):
            pass


if __name__ == "__main__":
    main()
