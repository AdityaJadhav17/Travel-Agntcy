# Copyright AGNTCY Contributors (https://github.com/agntcy)
# SPDX-License-Identifier: Apache-2.0

"""
Activity Search Agent Server

A2A server for handling activity search requests.
Uses A2AStarletteApplication for proper A2A protocol support.
"""

import asyncio
import os
from dotenv import load_dotenv
from uvicorn import Config, Server

from agntcy_app_sdk.semantic.a2a.protocol import A2AProtocol
from agntcy_app_sdk.app_sessions import AppContainer
from agntcy_app_sdk.factory import AgntcyFactory
from a2a.server.apps import A2AStarletteApplication
from a2a.server.tasks import InMemoryTaskStore
from a2a.server.request_handlers import DefaultRequestHandler

from agents.activity.agent_executor import ActivityAgentExecutor
from agents.activity.card import AGENT_CARD
from config.config import (
    DEFAULT_MESSAGE_TRANSPORT,
    TRANSPORT_SERVER_ENDPOINT,
    ENABLE_HTTP,
    TRACING_ENABLED,
)

load_dotenv()

# Initialize factory with tracing
factory = AgntcyFactory("lungo.activity_agent", enable_tracing=TRACING_ENABLED)


async def run_http_server(server):
    """Run the HTTP/REST server."""
    try:
        port = int(os.getenv("ACTIVITY_AGENT_PORT", "9003"))
        config = Config(app=server.build(), host="0.0.0.0", port=port, loop="asyncio")
        userver = Server(config)
        await userver.serve()
    except Exception:
        raise


async def run_transport(server, transport_type, endpoint):
    """Run the transport and message bridge."""
    app_session = None
    try:
        personal_topic = A2AProtocol.create_agent_topic(AGENT_CARD)
        transport = factory.create_transport(
            transport_type, 
            endpoint=endpoint, 
            name=f"default/default/{personal_topic}"
        )

        # Create an application session
        app_session = factory.create_app_session(max_sessions=1)
        
        # Add container for personal topic
        app_session.add_app_container("private_session", AppContainer(
            server,
            transport=transport,
            topic=personal_topic,
        ))

        await app_session.start_session("private_session")

    except Exception as e:
        print(f"Transport encountered an error: {e}")
        if app_session is not None:
            await app_session.stop_all_sessions()
        raise


async def main(enable_http: bool):
    """Run the A2A server with both HTTP and transport logic."""
    request_handler = DefaultRequestHandler(
        agent_executor=ActivityAgentExecutor(),
        task_store=InMemoryTaskStore(),
    )

    server = A2AStarletteApplication(
        agent_card=AGENT_CARD, 
        http_handler=request_handler
    )

    # Run HTTP server and transport logic concurrently
    tasks = []
    if enable_http:
        tasks.append(asyncio.create_task(run_http_server(server)))
    tasks.append(asyncio.create_task(run_transport(
        server, 
        DEFAULT_MESSAGE_TRANSPORT, 
        TRANSPORT_SERVER_ENDPOINT
    )))
    
    await asyncio.gather(*tasks)


if __name__ == '__main__':
    try:
        asyncio.run(main(ENABLE_HTTP))
    except KeyboardInterrupt:
        print("\nShutting down gracefully on keyboard interrupt.")
    except Exception as e:
        raise
