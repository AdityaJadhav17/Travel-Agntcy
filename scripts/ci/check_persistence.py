"""Run seed, restart the isolated CI API, then run verify. No real providers."""

import json
import sys
import urllib.request
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
    probe.write_text(json.dumps({"id": conversation_id}), encoding="utf-8")
elif sys.argv[1] == "verify":
    conversation_id = json.loads(probe.read_text(encoding="utf-8"))["id"]
    result = turn(conversation_id, "Actually Boston")
    assert result["trip_state"]["origin"] == "DFW", result
    assert result["trip_state"]["destination"] == "BOS", result
    assert result["trip_state"]["adults"] == 2, result
    assert result["trip_state"]["children"] == 1, result
    assert result["trip_state"]["children_ages"] == [7], result
    assert result["trip_state"]["rooms"] == 1, result
    with urllib.request.urlopen(urllib.request.Request(f"http://localhost:8000/conversations/{conversation_id}", method="DELETE")) as response:
        assert response.status == 204
    probe.unlink()
else:
    raise SystemExit("Expected seed or verify")
print("Persistence probe passed: " + sys.argv[1])
