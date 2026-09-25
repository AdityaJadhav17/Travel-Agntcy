"""Live model test of short replies/corrections, without a priced provider search.

Run in the supervisor: uv run --no-sync python scripts/conversation_smoke_test.py
"""

import argparse
import json
from urllib.request import Request, urlopen
from uuid import uuid4


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--budget', action='store_true', help='Also verify budget retention, revision and removal')
    args = parser.parse_args()
    conversation_id = str(uuid4())
    base = "http://localhost:8000"

    def send(prompt):
        payload = json.dumps({"prompt": prompt, "conversation_id": conversation_id, "request_id": str(uuid4())}).encode()
        request = Request(base + "/agent/prompt", data=payload, headers={"Content-Type": "application/json"})
        with urlopen(request, timeout=120) as response:
            return json.load(response)

    try:
        first = send("Plan a trip to New York." + (" My budget for the flight fare plus full hotel stay is USD 500 total; exclude other costs." if args.budget else ""))
        assert first["trip_state"]["destination"] in ("JFK", "NYC", "EWR", "LGA")
        second = send("Dallas.")
        assert second["trip_state"]["origin"] == "DFW", second["trip_state"]
        assert second["trip_state"]["destination"] == first["trip_state"]["destination"]
        if args.budget:
            assert second['trip_state']['budget_amount'] == 500, second['trip_state']
            assert second['trip_state']['budget_currency'] == 'USD'
            assert second['trip_state']['budget_scope'] == 'quoted_total'
        third = send("Actually Boston instead, keeping Dallas as my departure city." + (" Raise that same budget to USD 600." if args.budget else ""))
        assert third["trip_state"]["destination"] == "BOS", third["trip_state"]
        assert third["trip_state"]["origin"] == "DFW"
        assert not third["trip_state"]["start_date"]
        if args.budget:
            assert third['trip_state']['budget_amount'] == 600, third['trip_state']
            fourth = send('Remove the budget limit, keeping the same trip details.')
            assert fourth['trip_state']['budget_amount'] is None, fourth['trip_state']
            assert fourth['trip_state']['destination'] == 'BOS'
            assert fourth['trip_state']['origin'] == 'DFW'
            assert not fourth['trip_state']['start_date']
        print("Live clarification and correction passed" + (", including budget retention, revision and removal." if args.budget else "."))
    finally:
        with urlopen(Request(f"{base}/conversations/{conversation_id}", method="DELETE"), timeout=15):
            pass


if __name__ == "__main__":
    main()
