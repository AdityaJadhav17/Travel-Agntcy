"""Real FastAPI/graph/store, replacing only model responses for deterministic CI.

Agent calls still traverse real A2A/NATS services and provider HTTP fixtures.
Production entrypoints never import this module or enable these fixtures.
"""

import asyncio
import json
import re

from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableLambda

from agents.supervisors.travel.graph.models import TravelSearchArgs
from agents.supervisors.travel.main import app, travel_graph

__all__ = ["app"]

travel_graph.supervisor_llm = RunnableLambda(lambda _: AIMessage(content="travel_search"))
travel_graph.travel_search_llm = object()


async def extract(context):
    data = json.loads(context)
    params = dict(data["saved_trip"])
    prompt = data["latest_user_message"].lower()
    # Allow a browser to switch chats while this deterministic response is pending.
    await asyncio.sleep(0.4)
    for city, code in (("new york", "JFK"), ("boston", "BOS"), ("tokyo", "NRT")):
        if city in prompt:
            params.update(destination=code, destination_city=city.title(), location=city.title())
    if "dallas" in prompt:
        params["origin"] = "DFW"
    dates = re.findall(r"\d{4}-\d{2}-\d{2}", prompt)
    if dates:
        params["start_date"] = dates[0]
    if len(dates) > 1:
        params["end_date"] = dates[1]
    if "hotels only" in prompt:
        params["search_type"] = "hotel_only"
    if "flights only" in prompt:
        params["search_type"] = "flight_only"
    budget = re.search(r"budget (usd|eur) ([\d.]+)", prompt)
    if budget:
        params.update(budget_currency=budget[1].upper(), budget_amount=float(budget[2]), budget_scope="quoted_total")
    if "remove budget" in prompt:
        params.update(budget_currency=None, budget_amount=None, budget_scope=None)
    if "failure" in prompt:
        params.update(search_type="hotel_only", location="Failure City")
    params["clarification_question"] = ""
    return TravelSearchArgs(**params)


travel_graph._extract_travel_params = extract
