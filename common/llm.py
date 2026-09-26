# Copyright AGNTCY Contributors (https://github.com/agntcy)
# SPDX-License-Identifier: Apache-2.0

import logging
import os

from config.config import (
    LLM_MODEL, LLM_INTENT_MODEL, LLM_EXTRACTION_MODEL,
    LLM_REFLECTION_MODEL, LLM_REASONING_EFFORT,
)
from langchain_litellm import ChatLiteLLM
from langchain_openai import ChatOpenAI

import common.chat_lite_llm_shim as chat_lite_llm_shim # our drop-in client

logger = logging.getLogger("lungo.common.llm")
ROLE_MODELS = {
    "intent": LLM_INTENT_MODEL,
    "extraction": LLM_EXTRACTION_MODEL,
    "reflection": LLM_REFLECTION_MODEL,
}
REASONING_EFFORTS = {"none", "low", "medium", "high", "xhigh", "max"}


def get_llm(streaming: bool = True, *, role: str | None = None):
    """Select a model for a graph role, preserving the existing provider path.

    GPT-6 OpenAI models use Responses so reasoning and structured output can
    coexist. The application manages conversation state in SQLite, so Responses
    requests are stateless and do not store another copy on the provider.
    """
    if role is not None and role not in ROLE_MODELS:
        raise ValueError(f"Unknown LLM role: {role}")
    model = (ROLE_MODELS[role] if role else "") or LLM_MODEL
    if not model:
        raise ValueError("ACTION REQUIRED: add LLM_MODEL")

    proxy_base_url = os.getenv("LITELLM_PROXY_BASE_URL")
    proxy_api_key = os.getenv("LITELLM_PROXY_API_KEY")
    if model.startswith(("openai/gpt-6-", "gpt-6-")):
        if proxy_base_url or proxy_api_key:
            raise ValueError("GPT-6 Responses requires direct OpenAI API credentials, not the LiteLLM proxy")
        if LLM_REASONING_EFFORT not in REASONING_EFFORTS:
            raise ValueError(f"Unsupported LLM_REASONING_EFFORT: {LLM_REASONING_EFFORT}")
        return ChatOpenAI(
            model=model.removeprefix("openai/"),
            streaming=streaming,
            use_responses_api=True,
            reasoning={"effort": LLM_REASONING_EFFORT},
            store=False,
        )

    if proxy_base_url and proxy_api_key:
        logger.info("Using LLM via LiteLLM proxy: %s", proxy_base_url)
        return ChatOpenAI(
            base_url=proxy_base_url, model=model, api_key=proxy_api_key,
            streaming=streaming,
        )

    llm = ChatLiteLLM(model=model, streaming=streaming)
    if model.startswith("oauth2/"):
        llm.client = chat_lite_llm_shim
    return llm
