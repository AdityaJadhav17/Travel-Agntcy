# Copyright AGNTCY Contributors (https://github.com/agntcy)
# SPDX-License-Identifier: Apache-2.0

"""
Travel Supervisor Main Entry Point

FastAPI server for the Travel Planning Agent.
This server exposes REST endpoints for:
- Processing travel planning requests
- Streaming travel search results
- Health checks and configuration

The travel agent helps users find the cheapest flight + hotel combinations
by searching SerpAPI and applying timing constraints.
"""

import logging
import json
from pathlib import Path
from uuid import UUID
from asyncio import to_thread

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
import uvicorn
from agntcy_app_sdk.factory import AgntcyFactory
from ioa_observe.sdk.tracing import session_start

from agents.supervisors.travel.graph.graph import TravelGraph
from agents.supervisors.travel.graph import shared
from agents.supervisors.travel.conversations import ConversationStore, ConversationConflict, ConversationTurns
from config.config import DEFAULT_MESSAGE_TRANSPORT, TRACING_ENABLED
from config.logging_config import setup_logging
from common.version import get_version_info

# Initialize logging
setup_logging()
logger = logging.getLogger("lungo.travel.supervisor.main")

# Load environment variables
load_dotenv()

# Initialize the shared agntcy factory with tracing enabled
# This enables observability for all agent operations
shared.set_factory(AgntcyFactory("lungo.travel_supervisor", enable_tracing=TRACING_ENABLED))

# Create FastAPI application
app = FastAPI(
    title="Travel Planning Agent",
    description="AI agent that finds the cheapest flight + hotel combinations for trips",
    version="1.0.0",
)

# Add CORS middleware for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure specific origins in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize the travel graph (LangGraph workflow)
travel_graph = TravelGraph()
conversation_store = ConversationStore()
conversation_turns = ConversationTurns()


class PromptRequest(BaseModel):
    """Request model for travel planning prompts."""
    prompt: str = Field(max_length=12000)
    conversation_id: UUID | None = None
    request_id: UUID | None = None

    @field_validator("prompt")
    @classmethod
    def validate_prompt(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Prompt must be a non-empty string")
        return value.strip()


@app.get("/.well-known/agent.json")
async def get_capabilities():
    """
    Returns the capabilities of the travel agent (A2A protocol).
    
    This endpoint provides metadata about the agent following the
    Agent-to-Agent (A2A) protocol specification.
    
    Returns:
        dict: Agent capabilities and metadata
    """
    return {
        "capabilities": {"streaming": True},
        "defaultInputModes": ["text"],
        "defaultOutputModes": ["text"],
        "description": "An AI agent that finds the cheapest flight + hotel combinations for trips using SerpAPI.",
        "name": "Travel Planning Agent",
        "preferredTransport": "JSONRPC",
        "protocolVersion": "0.3.0",
        "skills": [
            {
                "description": "Search for the cheapest flight and hotel combination for a trip.",
                "examples": [
                    "Find me the cheapest flight and hotel from LAX to Tokyo, Jan 15-22, 2026",
                    "I need a trip from NYC to Paris, Feb 1-10, 2026",
                    "What's the best deal for a trip from San Francisco to London next month?",
                ],
                "id": "find_travel_plan",
                "name": "Find Travel Plan",
                "tags": ["travel", "flights", "hotels", "planning"],
            }
        ],
        "supportsAuthenticatedExtendedCard": False,
        "url": "",
        "version": "1.0.0",
    }


@app.post("/agent/prompt")
async def handle_prompt(request: PromptRequest):
    """
    Process a travel planning request (non-streaming).
    
    This endpoint accepts a natural language travel request and returns
    the optimal flight + hotel combination after searching SerpAPI.
    
    Args:
        request: PromptRequest containing the user's travel request
    
    Returns:
        dict: Response containing the travel plan and session ID
    
    Raises:
        HTTPException: 400 for invalid input, 500 for server errors
    
    Example request:
        POST /agent/prompt
        {"prompt": "Find me flights from LAX to Tokyo, Jan 15-22, 2026"}
    """
    try:
        with session_start() as session_id:
            if request.conversation_id:
                if not request.request_id:
                    raise HTTPException(422, "request_id is required for a conversation turn")
                conversation_id = str(request.conversation_id)
                request_id = str(request.request_id)
                async with conversation_turns.acquire(conversation_id):
                    saved = await to_thread(conversation_store.load, conversation_id)
                    cached = saved["requests"].get(request_id)
                    if cached:
                        if cached["prompt"] != request.prompt:
                            raise HTTPException(409, "This request ID was already used for another message")
                        return cached["result"]
                    turn = await travel_graph.serve_conversation(request.prompt, saved["messages"], saved["trip"])
                    result = {**turn, "conversation_id": conversation_id, "session_id": session_id["executionID"]}
                    await to_thread(conversation_store.save, conversation_id, saved, request_id, request.prompt, result)
                    return result
            # Execute the travel graph and wait for completion
            result = await travel_graph.serve(request.prompt)
            logger.info(f"Travel search completed, session: {session_id['executionID']}")
            return {"response": result, "session_id": session_id["executionID"]}
    except HTTPException:
        raise
    except ConversationConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as ve:
        logger.error(f"Invalid input: {ve}")
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error processing travel request: {e}")
        raise HTTPException(status_code=500, detail="Travel request failed. Please try again.")


@app.delete("/conversations/{conversation_id}", status_code=204)
async def delete_conversation(conversation_id: UUID):
    """Delete local conversation memory; account ownership is a future deployment requirement."""
    await to_thread(conversation_store.delete, str(conversation_id))


@app.post("/agent/prompt/stream")
async def handle_stream_prompt(request: PromptRequest):
    """
    Process a travel planning request with streaming response.
    
    This endpoint streams results as they're generated, providing
    real-time updates during the flight/hotel search process.
    
    Args:
        request: PromptRequest containing the user's travel request
    
    Returns:
        StreamingResponse: NDJSON stream with progressive updates
    
    Raises:
        HTTPException: 400 for invalid input, 500 for server errors
    
    Response format (NDJSON - one JSON object per line):
        {"response": "Searching for flights...", "session_id": "..."}
        {"response": "Found 15 flights...", "session_id": "..."}
        {"response": "Best deal: $1,234 total...", "session_id": "..."}
    """
    if request.conversation_id:
        raise HTTPException(400, "Conversation streaming is not supported yet; use /agent/prompt")

    async def stream_generator():
        # Keep the tracing context alive for the entire asynchronous iteration.
        with session_start() as session_id:
            try:
                async for chunk in travel_graph.streaming_serve(request.prompt):
                    yield json.dumps({"response": chunk, "session_id": session_id["executionID"]}) + "\n"
            except Exception:
                logger.error("Travel stream failed")
                yield json.dumps({"response": "Travel search failed. Check provider credentials and service logs.", "session_id": session_id["executionID"]}) + "\n"

    return StreamingResponse(
        stream_generator(), media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/health")
async def health_check():
    """
    Basic health check endpoint.
    
    Returns:
        dict: Status indicator
    """
    return {"status": "ok"}


@app.get("/transport/config")
async def get_config():
    """
    Returns the current transport configuration.
    
    Returns:
        dict: Transport settings (NATS or SLIM)
    """
    return {
        "transport": DEFAULT_MESSAGE_TRANSPORT.upper()
    }


@app.get("/about")
async def version_info():
    """
    Return build info sourced from about.properties.
    
    Returns:
        dict: Version and build information
    """
    props_path = Path(__file__).resolve().parents[3] / "about.properties"
    return get_version_info(props_path)


@app.get("/suggested-prompts")
async def get_prompts(pattern: str = "default"):
    """
    Fetch suggested prompts for the travel agent.
    
    These prompts help users understand what the agent can do
    and provide example queries they can try.
    
    Args:
        pattern: Prompt category (default or streaming)
    
    Returns:
        dict: Lists of suggested prompts by category
    
    Raises:
        HTTPException: 500 if prompts file cannot be read
    """
    try:
        prompts_path = Path(__file__).resolve().parent / "suggested_prompts.json"
        raw = prompts_path.read_text(encoding="utf-8")
        data = json.loads(raw)

        if pattern == "streaming":
            streaming_prompts = data.get("streaming_prompts", [])
            return {"streaming": streaming_prompts}

        # Return travel-related prompts
        travel_prompts = data.get("travel", [])
        return {"travel": travel_prompts}

    except Exception as e:
        logger.error(f"Error reading prompts: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="An unexpected error occurred while reading prompts."
        )


# Run the FastAPI server using uvicorn
if __name__ == "__main__":
    uvicorn.run(
        "agents.supervisors.travel.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
