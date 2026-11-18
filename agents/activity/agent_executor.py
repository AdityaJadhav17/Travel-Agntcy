# Copyright AGNTCY Contributors (https://github.com/agntcy)
# SPDX-License-Identifier: Apache-2.0

"""
Activity Search Agent Executor

A2A AgentExecutor that handles incoming activity search requests.
"""

import logging
from uuid import uuid4

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.types import (
    UnsupportedOperationError,
    JSONRPCResponse,
    ContentTypeNotSupportedError,
    InternalError,
    Message,
    Role,
    Part,
    TextPart,
    Task,
)
from a2a.utils import new_task
from a2a.utils.errors import ServerError

from agents.activity.agent import ActivitySearchAgent
from agents.activity.card import AGENT_CARD
from common.travel_timing import reset_request_id, set_request_id, valid_request_id

logger = logging.getLogger("lungo.activity.agent_executor")


class ActivityAgentExecutor(AgentExecutor):
    """A2A executor for the Activity Search Agent."""
    
    def __init__(self):
        self.agent = ActivitySearchAgent()
        self.agent_card = AGENT_CARD.model_dump(mode="json", exclude_none=True)

    def _validate_request(self, context: RequestContext) -> JSONRPCResponse | None:
        """Validates the incoming request."""
        if not context or not context.message or not context.message.parts:
            logger.error("Invalid request parameters")
            return JSONRPCResponse(error=ContentTypeNotSupportedError())
        return None
    
    async def execute(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        """Execute a request with a validated, task-local timing correlation id."""
        metadata = getattr(getattr(context, "message", None), "metadata", None)
        incoming_id = metadata.get("travel_timing_id") if isinstance(metadata, dict) else None
        token = set_request_id(incoming_id if valid_request_id(incoming_id) else None)
        try:
            await self._execute_request(context, event_queue)
        finally:
            reset_request_id(token)

    async def _execute_request(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        """
        Execute the activity search for a given request context.
        """
        logger.debug("Received activity search request")

        validation_error = self._validate_request(context)
        if validation_error:
            await event_queue.enqueue_event(validation_error)
            return
        
        prompt = context.get_user_input()
        task = context.current_task
        if not task:
            task = new_task(context.message)
            await event_queue.enqueue_event(task)

        try:
            # Invoke the activity search agent
            output = await self.agent.ainvoke(prompt)
        
            message = Message(
                message_id=str(uuid4()),
                role=Role.agent,
                metadata={"name": self.agent_card["name"]},
                parts=[Part(TextPart(text=output))],
            )

            logger.info("Activity agent output: %s", output[:100] if output else "empty")

            await event_queue.enqueue_event(message)              
        except Exception as e:
            logger.error(f'Error during activity search: {e}')
            raise ServerError(error=InternalError()) from e
        
    async def cancel(
        self, request: RequestContext, event_queue: EventQueue
    ) -> Task | None:
        """Cancel this agent's execution."""
        raise ServerError(error=UnsupportedOperationError())
