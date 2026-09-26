"""Run a small live-model comparison without flight or hotel provider calls.

Examples (from a supervisor image with an OpenAI API key):
  python scripts/compare_supervisor_models.py --model openai/gpt-5.2
  python scripts/compare_supervisor_models.py --model openai/gpt-6-sol

Each run uses the real travel graph with isolated in-memory conversations. No
priced provider search is reached because these journeys leave dates undecided.
"""

import argparse
import asyncio
import json
import os
import statistics
import time
from pathlib import Path
from unittest.mock import patch


PRICES_PER_MILLION = {
    "openai/gpt-5.2": (1.75, 0.175, 14.0),
    "openai/gpt-6-sol": (2.0, 0.20, 10.0),
}


class Usage:
    """Collect LangChain usage from both ChatLiteLLM and ChatOpenAI calls."""

    def __init__(self):
        from langchain_core.callbacks import BaseCallbackHandler

        class Handler(BaseCallbackHandler):
            def on_llm_end(_self, response, **_kwargs):
                for generation in response.generations:
                    for candidate in generation:
                        message = getattr(candidate, "message", None)
                        metadata = getattr(message, "usage_metadata", None)
                        if metadata:
                            self.input_tokens += metadata.get("input_tokens", 0)
                            self.output_tokens += metadata.get("output_tokens", 0)
                            self.cached_input_tokens += (metadata.get("input_token_details") or {}).get(
                                "cache_read", 0)
                            self.calls += 1
                            return
                token_usage = (response.llm_output or {}).get("token_usage") or {}
                if token_usage:
                    self.input_tokens += token_usage.get("prompt_tokens", 0)
                    self.output_tokens += token_usage.get("completion_tokens", 0)
                    self.cached_input_tokens += (token_usage.get("prompt_tokens_details") or {}).get(
                        "cached_tokens", 0)
                    self.calls += 1

        self.input_tokens = 0
        self.output_tokens = 0
        self.cached_input_tokens = 0
        self.calls = 0
        self.handler = Handler()


JOURNEYS = [
    ("short_correction", [
        ("Plan a trip to New York. I have not chosen dates yet.",
         {"destination": {"JFK", "NYC", "EWR", "LGA"}}),
        ("Dallas is my departure city.", {"origin": "DFW"}),
        ("Actually Boston instead, keeping Dallas and no dates yet.",
         {"destination": "BOS", "origin": "DFW"}),
    ]),
    ("family_continuity", [
        ("Plan a trip to New York for two adults and one seven-year-old child in two rooms. "
         "Dates are undecided.", {"adults": 2, "children": 1, "children_ages": [7], "rooms": 2}),
        ("One room is fine; keep the same travelers and no dates.",
         {"adults": 2, "children": 1, "children_ages": [7], "rooms": 1}),
        ("Change the destination to Boston, still no dates.",
         {"destination": "BOS", "adults": 2, "children": 1, "children_ages": [7]}),
    ]),
    ("nearby_arrival_followup", [
        ("I want to fly from DFW to SBP, but I have not chosen dates yet.",
         {"origin": "DFW", "destination": "SBP"}),
        ("Could you check cheaper flights to nearby arrival airports? "
         "Keep San Luis Obispo as my destination; I still need to choose dates.",
         {"origin": "DFW", "destination": "SBP"}),
    ]),
    ("budget_correction", [
        ("Plan a trip from Dallas to Boston, with no dates yet. My total budget "
         "for airfare plus the hotel stay is USD 800.",
         {"origin": "DFW", "destination": "BOS", "budget_amount": 800,
          "budget_currency": "USD", "budget_scope": "quoted_total"}),
        ("Lower that same total budget to USD 650. Keep the trip and no dates.",
         {"origin": "DFW", "destination": "BOS", "budget_amount": 650}),
        ("Remove the budget limit. Keep Dallas to Boston and no dates.",
         {"origin": "DFW", "destination": "BOS", "budget_amount": None}),
    ]),
]


async def evaluate(model: str) -> dict:
    from langchain_core.messages import AIMessage, HumanMessage

    from agents.supervisors.travel.graph.graph import TravelGraph

    usage = Usage()
    turns = []
    provider_attempts = []

    def block_provider(*_args, **_kwargs):
        provider_attempts.append(True)
        raise AssertionError("Travel providers are disabled in the live-model comparison")

    with (patch("agents.supervisors.travel.graph.graph.get_flights_via_a2a",
                side_effect=block_provider),
          patch("agents.supervisors.travel.graph.graph.get_hotels_via_a2a",
                side_effect=block_provider),
          patch("agents.supervisors.travel.graph.graph.get_activities_via_a2a",
                side_effect=block_provider)):
        for journey_name, steps in JOURNEYS:
            graph = TravelGraph()
            history = []
            trip = {}
            for prompt, expected in steps:
                started = time.perf_counter()
                previous_provider_attempts = len(provider_attempts)
                try:
                    state = await asyncio.wait_for(graph.graph.ainvoke({
                        "messages": history[-12:] + [{"role": "user", "content": prompt}],
                        "search_params": trip,
                        "recommendation": None,
                        "partial_search": None,
                    }, config={"callbacks": [usage.handler]}), timeout=120)
                    answer = next(m.content for m in reversed(state["messages"])
                                  if isinstance(m, AIMessage) and isinstance(m.content, str))
                    trip = state.get("search_params", trip)
                    failed = [field for field, value in expected.items()
                              if (trip.get(field) not in value if isinstance(value, set)
                                  else trip.get(field) != value)]
                    error = f"Incorrect fields: {', '.join(failed)}" if failed else None
                    if len(provider_attempts) != previous_provider_attempts:
                        error = "Unexpected travel provider call"
                    history.extend((HumanMessage(content=prompt), AIMessage(content=answer)))
                except Exception as exc:
                    error = f"{type(exc).__name__}: {exc}"
                turn = {"journey": journey_name, "prompt": prompt,
                        "passed": error is None, "latency_ms": round((time.perf_counter() - started) * 1000),
                        "error": error}
                turns.append(turn)
                print(f"{model}: {journey_name} {'PASS' if turn['passed'] else 'FAIL'} "
                      f"({turn['latency_ms']} ms)", flush=True)

    latencies = [turn["latency_ms"] for turn in turns]
    prices = PRICES_PER_MILLION.get(model)
    estimated_cost = None
    if prices and usage.calls:
        uncached = max(0, usage.input_tokens - usage.cached_input_tokens)
        estimated_cost = round((uncached * prices[0] + usage.cached_input_tokens * prices[1] +
                                usage.output_tokens * prices[2]) / 1_000_000, 6)
    return {
        "model": model, "scenario": "live_graph_without_priced_providers",
        "passed": sum(turn["passed"] for turn in turns), "total": len(turns),
        "median_latency_ms": round(statistics.median(latencies)),
        "p95_latency_ms": round(sorted(latencies)[-1]),
        "usage": {"calls": usage.calls, "input_tokens": usage.input_tokens,
                  "cached_input_tokens": usage.cached_input_tokens,
                  "output_tokens": usage.output_tokens,
                  "estimated_model_usd": estimated_cost},
        "turns": turns,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=PRICES_PER_MILLION, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    os.environ["LLM_MODEL"] = args.model
    for role in ("INTENT", "EXTRACTION", "REFLECTION"):
        os.environ[f"LLM_{role}_MODEL"] = ""
    if args.model == "openai/gpt-6-sol":
        os.environ["LLM_REASONING_EFFORT"] = "low"
    result = asyncio.run(evaluate(args.model))
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["passed"] == result["total"] else 1)


if __name__ == "__main__":
    main()
