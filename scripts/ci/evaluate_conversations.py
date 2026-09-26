"""Score credential-free conversation journeys against the isolated CI stack.

Run ``seed`` before restarting the CI API and ``verify`` after it restarts.
The JSON report is printed to stdout; fixture counters are cost proxies, not
real model tokens, money, or evidence of live-model language accuracy.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
import json
import os
from pathlib import Path
import statistics
import sys
from time import perf_counter
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from agents.supervisors.travel.conversations import ConversationStore


API = os.environ.get("EVAL_API_URL", "http://localhost:8000").rstrip("/")
PROVIDERS = os.environ.get("EVAL_PROVIDER_URL", "http://providers:9000").rstrip("/")
SEED = Path("/data/conversation-eval-seed.json")
STORE = ConversationStore(Path(os.environ.get("TRAVEL_CONVERSATION_DB", "/data/conversations.sqlite3")))


def get_json(url):
    with urlopen(url, timeout=35) as response:
        return json.load(response)


def counters():
    model = get_json(f"{API}/__eval/metrics")["extraction_calls"]
    providers = get_json(f"{PROVIDERS}/__eval/metrics")["provider_calls"]
    return {"fixture_extractions": model, **{f"provider_{key}": value for key, value in providers.items()}}


def request(conversation_id, prompt, request_id=None):
    payload = {"conversation_id": conversation_id, "request_id": request_id or str(uuid4()), "prompt": prompt}
    outgoing = Request(f"{API}/agent/prompt", json.dumps(payload).encode(), {"Content-Type": "application/json"})
    try:
        with urlopen(outgoing, timeout=35) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.load(error)


class Evaluation:
    def __init__(self):
        self.rows = []
        self.checks = []
        self.scenarios = []
        self.active = ""

    def scenario(self, name, function):
        self.active = name
        before = len(self.checks)
        try:
            function()
        except Exception as error:  # Keep the report useful when an API step fails.
            self.check(False, f"unexpected {type(error).__name__}: {error}", kind="execution")
        failed = [item["claim"] for item in self.checks[before:] if not item["passed"]]
        self.scenarios.append({"name": name, "passed": not failed, "failed_checks": failed})

    def check(self, condition, claim, kind="assumption"):
        self.checks.append({"scenario": self.active, "claim": claim,
                            "kind": kind, "passed": bool(condition)})

    def turn(self, conversation_id, prompt, request_id=None):
        before = counters()
        start = perf_counter()
        status, result = request(conversation_id, prompt, request_id)
        elapsed = round((perf_counter() - start) * 1000, 1)
        after = counters()
        self.rows.append({
            "scenario": self.active,
            "prompt": prompt,
            "status": status,
            "latency_ms": elapsed,
            "cost_proxy": {key: after[key] - value for key, value in before.items()},
        })
        self.check(status == 200, f"{prompt!r} returned HTTP 200", kind="http")
        return result

    def report(self):
        times = sorted(row["latency_ms"] for row in self.rows)
        p95 = times[max(0, (len(times) * 95 + 99) // 100 - 1)] if times else 0
        costs = {key: sum(row["cost_proxy"][key] for row in self.rows) for key in counters()}
        passed = sum(item["passed"] for item in self.scenarios)
        return {
            "schema_version": 1,
            "mode": "deterministic_ci_fixture",
            "task_completion": {"passed": passed, "total": len(self.scenarios),
                                "rate": round(passed / len(self.scenarios), 3) if self.scenarios else 0},
            "incorrect_assumptions": sum(not check["passed"] and check["kind"] == "assumption"
                                         for check in self.checks),
            "failed_checks": sum(not check["passed"] for check in self.checks),
            "latency_ms": {"median": round(statistics.median(times), 1) if times else 0, "p95": p95},
            "tool_cost_proxy": costs,
            "scenarios": self.scenarios,
            "checks": self.checks,
            "turns": self.rows,
        }


def future_dates():
    start = date.today() + timedelta(days=75)
    return start, start + timedelta(days=3)


def continuity(evaluation):
    conversation = str(uuid4())
    first = evaluation.turn(conversation, "Plan New York")
    evaluation.check(first["trip_state"].get("destination") == "JFK", "destination captured")
    evaluation.check(first["trip_state"].get("origin") is None, "origin not invented")
    second = evaluation.turn(conversation, "Dallas")
    evaluation.check(second["trip_state"].get("origin") == "DFW", "clarification keeps destination")
    start, end = future_dates()
    third = evaluation.turn(conversation, f"{start} to {end}")
    evaluation.check(third.get("travel_result", {}).get("kind") == "full_trip", "completed full trip")
    corrected = evaluation.turn(conversation, "Actually Boston")
    trip = corrected["trip_state"]
    evaluation.check(trip.get("destination") == "BOS" and trip.get("origin") == "DFW", "correction preserves origin")
    evaluation.check(trip.get("start_date") == str(start) and trip.get("end_date") == str(end), "correction preserves dates")


def ambiguous_dates(evaluation):
    conversation = str(uuid4())
    first = evaluation.turn(conversation, "Plan Dallas to New York in early October")
    evaluation.check("Which dates" in first["response"], "ambiguous date asks a question")
    evaluation.check(first["trip_state"].get("start_date") is None, "ambiguous date not invented")
    start, end = future_dates()
    completed = evaluation.turn(conversation, f"{start} to {end}")
    evaluation.check(completed["trip_state"].get("start_date") == str(start), "date clarification retained")


def isolation(evaluation):
    one, two = str(uuid4()), str(uuid4())
    evaluation.turn(one, "Plan Dallas to New York")
    separate = evaluation.turn(two, "Plan Boston")
    evaluation.check(separate["trip_state"].get("origin") is None, "other chat does not inherit origin")
    evaluation.check(separate["trip_state"].get("destination") == "BOS", "other chat keeps own destination")


def long_chat(evaluation):
    conversation = str(uuid4())
    evaluation.turn(conversation, "Plan New York")
    for index in range(21):
        evaluation.turn(conversation, f"Question {index + 1}")
    saved = STORE.load(conversation)
    evaluation.check(len(saved["messages"]) == 40, "long chat retains bounded recent context")
    evaluation.check(saved["trip"].get("destination") == "JFK", "structured destination survives truncation")
    evaluation.check(all(sum(row["cost_proxy"][f"provider_{engine}"] for engine in
                             ("google_flights", "google_hotels", "other")) == 0
                         for row in evaluation.rows if row["scenario"] == evaluation.active),
                     "incomplete long chat does not query providers")


def retry_conflicts(evaluation):
    conversation, retry_id = str(uuid4()), str(uuid4())
    before = counters()
    start = perf_counter()
    with ThreadPoolExecutor(max_workers=2) as pool:
        calls = list(pool.map(lambda _: request(conversation, "Plan New York", retry_id), range(2)))
    elapsed = round((perf_counter() - start) * 1000, 1)
    after = counters()
    cost = {key: after[key] - value for key, value in before.items()}
    evaluation.rows.append({"scenario": evaluation.active, "prompt": "two concurrent identical turns",
                            "status": [item[0] for item in calls], "latency_ms": elapsed, "cost_proxy": cost})
    evaluation.check(calls[0][0] == calls[1][0] == 200 and calls[0][1] == calls[1][1], "concurrent retry has one answer")
    evaluation.check(cost["fixture_extractions"] == 1, "concurrent retry runs extraction once")
    evaluation.check(STORE.load(conversation)["revision"] == 1, "concurrent retry saves one turn")
    status, _ = request(conversation, "Different prompt", retry_id)
    evaluation.check(status == 409, "same request ID with different text conflicts")


def provider_failure(evaluation):
    conversation = str(uuid4())
    start, end = future_dates()
    partial = evaluation.turn(conversation, f"Plan Dallas to New York with transient hotel {uuid4()} {start} to {end}")
    evaluation.check(partial.get("travel_result", {}).get("kind") == "flight_only", "hotel failure preserves flights")
    evaluation.check(partial.get("retry_hotels") is True, "hotel failure enables focused retry")
    completed = evaluation.turn(conversation, "Retry hotels")
    evaluation.check(completed.get("travel_result", {}).get("kind") == "full_trip", "retry completes trip")
    evaluation.check(completed.get("partial_search") is None, "successful retry clears partial result")
    evaluation.check(evaluation.rows[-1]["cost_proxy"]["provider_google_flights"] == 0,
                     "fresh flight quote is reused during hotel retry")
    evaluation.check(evaluation.rows[-1]["cost_proxy"]["provider_google_hotels"] >= 1,
                     "hotel retry queries the hotel provider")


def unsupported_constraints(evaluation):
    conversation = str(uuid4())
    start, end = future_dates()
    first = evaluation.turn(conversation, f"Plan Dallas to New York {start} to {end} 2 adults 1 child 2 rooms")
    evaluation.check(first.get("travel_result") is None, "missing child age is not quoted")
    age = evaluation.turn(conversation, "age 7")
    evaluation.check("supports one room only" in age["response"], "two-room limitation is disclosed")
    evaluation.check(age.get("travel_result") is None, "unsupported room count is not searched")
    foreign = evaluation.turn(str(uuid4()), f"Plan Dallas to New York {start} to {end} budget eur 1000")
    evaluation.check(foreign.get("budget_assessment") is None, "EUR not silently treated as USD")
    evaluation.check("cannot convert your EUR budget" in foreign["response"], "currency limitation disclosed")


def grounded_explanation(evaluation):
    conversation = str(uuid4())
    start, end = future_dates()
    chosen = evaluation.turn(conversation, f"Plan Dallas to New York {start} to {end}")
    explained = evaluation.turn(conversation, "Why this one?")
    evaluation.check(explained.get("recommendation") == chosen.get("recommendation"), "explanation cites retained selection")
    evaluation.check(evaluation.rows[-1]["cost_proxy"]["provider_google_flights"] == 0, "explanation makes no flight search")
    evaluation.check(evaluation.rows[-1]["cost_proxy"]["provider_google_hotels"] == 0, "explanation makes no hotel search")


def nearby_airports(evaluation):
    conversation = str(uuid4())
    start, end = future_dates()
    initial = evaluation.turn(conversation, f"Flights only from Dallas to SBP {start} to {end}")
    evaluation.check(initial.get("travel_result", {}).get("kind") == "flight_only", "requested airport is searched first")
    compared = evaluation.turn(conversation, "Find cheaper flights to nearby airports to SBP")
    result = compared.get("travel_result") or {}
    evaluation.check(compared["trip_state"].get("destination") == "SBP", "original destination remains SBP")
    evaluation.check(result.get("kind") == "airport_comparison", "alternative-arrival comparison returned")
    evaluation.check(result.get("requested_fare_usd") == 529, "requested-airport fare is the baseline")
    lax = next((option for option in result.get("airport_alternatives", [])
                if option["arrival_airport"] == "LAX"), None)
    evaluation.check(lax is not None and lax["savings_usd"] == 229, "cheaper LAX airfare is verified")
    evaluation.check(lax is not None and lax["driving_miles"] is not None,
                     "driving miles to destination city are returned when routing is available")
    evaluation.check("Ground-transfer cost is unknown" in result.get("notice", ""),
                     "unknown transfer cost is disclosed")


def restart(evaluation, seed):
    continued = evaluation.turn(seed["conversation_id"], "Dallas")
    evaluation.check(continued["trip_state"].get("origin") == "DFW", "origin added after API restart")
    evaluation.check(continued["trip_state"].get("destination") == "JFK", "destination survived API restart")


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in {"seed", "verify"}:
        raise SystemExit("Usage: evaluate_conversations.py seed|verify")
    if sys.argv[1] == "seed":
        conversation = str(uuid4())
        status, result = request(conversation, "Plan New York")
        assert status == 200 and result["trip_state"].get("destination") == "JFK"
        SEED.write_text(json.dumps({"conversation_id": conversation}), encoding="utf-8")
        print("Conversation evaluation seeded before API restart", file=sys.stderr)
        return

    seed = json.loads(SEED.read_text(encoding="utf-8"))
    evaluation = Evaluation()
    evaluation.scenario("restart_recovery", lambda: restart(evaluation, seed))
    for name, function in (
        ("continuity_and_correction", continuity),
        ("ambiguous_dates", ambiguous_dates),
        ("context_isolation", isolation),
        ("long_chat", long_chat),
        ("retry_conflicts", retry_conflicts),
        ("provider_failure", provider_failure),
        ("unsupported_constraints", unsupported_constraints),
        ("grounded_explanation", grounded_explanation),
        ("nearby_airport_comparison", nearby_airports),
    ):
        evaluation.scenario(name, lambda function=function: function(evaluation))
    report = evaluation.report()
    print(json.dumps(report, indent=2))
    SEED.unlink()
    if report["task_completion"]["passed"] != report["task_completion"]["total"]:
        raise SystemExit("Conversation evaluation failed; inspect JSON report")


if __name__ == "__main__":
    main()
