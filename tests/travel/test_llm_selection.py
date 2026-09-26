"""Model routing keeps the live provider path stable and enables GPT-6 Responses."""

import asyncio
from unittest.mock import Mock

import pytest
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableLambda

from common import llm
from agents.supervisors.travel.graph.graph import NodeStates, TravelGraph


def test_gpt6_role_override_uses_stateless_responses(monkeypatch):
    client = Mock()
    monkeypatch.setitem(llm.ROLE_MODELS, "intent", "openai/gpt-6-sol")
    monkeypatch.setattr(llm, "LLM_REASONING_EFFORT", "low")
    monkeypatch.setattr(llm, "ChatOpenAI", client)
    monkeypatch.delenv("LITELLM_PROXY_BASE_URL", raising=False)
    monkeypatch.delenv("LITELLM_PROXY_API_KEY", raising=False)

    assert llm.get_llm(streaming=False, role="intent") is client.return_value
    client.assert_called_once_with(
        model="gpt-6-sol", streaming=False, use_responses_api=True,
        reasoning={"effort": "low"}, store=False,
    )


def test_unset_role_keeps_existing_litellm_model(monkeypatch):
    client = Mock()
    monkeypatch.setattr(llm, "LLM_MODEL", "openai/gpt-5.2")
    monkeypatch.setitem(llm.ROLE_MODELS, "extraction", "")
    monkeypatch.setattr(llm, "ChatLiteLLM", client)
    monkeypatch.delenv("LITELLM_PROXY_BASE_URL", raising=False)
    monkeypatch.delenv("LITELLM_PROXY_API_KEY", raising=False)

    assert llm.get_llm(role="extraction") is client.return_value
    client.assert_called_once_with(model="openai/gpt-5.2", streaming=True)


def test_gpt6_refuses_chat_only_proxy(monkeypatch):
    monkeypatch.setitem(llm.ROLE_MODELS, "reflection", "openai/gpt-6-sol")
    monkeypatch.setenv("LITELLM_PROXY_BASE_URL", "http://proxy.invalid")
    monkeypatch.setenv("LITELLM_PROXY_API_KEY", "fixture")
    with pytest.raises(ValueError, match="direct OpenAI API"):
        llm.get_llm(role="reflection")


def test_intent_router_accepts_responses_content_blocks():
    graph = TravelGraph()
    graph.supervisor_llm = RunnableLambda(lambda _: AIMessage(
        content=[{"type": "text", "text": "travel_search"}]))
    state = {"messages": [HumanMessage(content="Find me a flight to Boston")]}
    result = asyncio.run(graph._supervisor_node(state))
    assert result["next_node"] == NodeStates.TRAVEL_SEARCH
