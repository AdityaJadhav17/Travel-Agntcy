"""Run seed, restart the isolated CI API, then run verify. No real providers."""

import json
import sys
import urllib.request
from datetime import date, timedelta
from pathlib import Path
from uuid import uuid4

probe = Path("/data/ci-persistence-probe.json")


def turn(conversation_id, prompt):
    body = {"conversation_id": conversation_id, "request_id": str(uuid4()), "prompt": prompt}
    request = urllib.request.Request("http://localhost:8000/agent/prompt", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


if sys.argv[1] == "seed":
    conversation_id = str(uuid4())
    saved = turn(conversation_id, "Plan New York for 2 adults 1 child age 7 in 1 room")
    assert saved["trip_state"]["destination"] == "JFK"
    assert saved["trip_state"]["children_ages"] == [7]
    assert turn(conversation_id, "Dallas")["trip_state"]["origin"] == "DFW"
    recommendation_id = str(uuid4())
    start = date.today() + timedelta(days=60)
    end = start + timedelta(days=3)
    selected = turn(recommendation_id, f"Plan Dallas to New York {start} to {end}")["recommendation"]
    assert selected["hotel"]["name"] == "Fixture Central Hotel", selected
    probe.write_text(json.dumps({"id": conversation_id, "recommendation_id": recommendation_id, "recommendation": selected}), encoding="utf-8")
elif sys.argv[1] == "verify":
    saved_probe = json.loads(probe.read_text(encoding="utf-8"))
    conversation_id = saved_probe["id"]
    result = turn(conversation_id, "Actually Boston")
    assert result["trip_state"]["origin"] == "DFW", result
    assert result["trip_state"]["destination"] == "BOS", result
    assert result["trip_state"]["adults"] == 2, result
    assert result["trip_state"]["children"] == 1, result
    assert result["trip_state"]["children_ages"] == [7], result
    assert result["trip_state"]["rooms"] == 1, result
    explanation = turn(saved_probe["recommendation_id"], "Why this one?")
    assert explanation["recommendation"] == saved_probe["recommendation"], explanation
    assert "USD 540.00" in explanation["response"], explanation
    replaced = turn(saved_probe["recommendation_id"], "Keep the flights, change the hotel")
    assert replaced["recommendation"]["flight"]["id"] == saved_probe["recommendation"]["flight"]["id"], replaced
    assert replaced["recommendation"]["hotel"]["name"] == "Fixture Riverside Hotel", replaced
    with urllib.request.urlopen(urllib.request.Request(f"http://localhost:8000/conversations/{saved_probe['recommendation_id']}", method="DELETE")) as response:
        assert response.status == 204
    with urllib.request.urlopen(urllib.request.Request(f"http://localhost:8000/conversations/{conversation_id}", method="DELETE")) as response:
        assert response.status == 204
    probe.unlink()
else:
    raise SystemExit("Expected seed or verify")
print("Persistence probe passed: " + sys.argv[1])
