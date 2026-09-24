# Copyright AGNTCY Contributors (https://github.com/agntcy)
# SPDX-License-Identifier: Apache-2.0

"""
Activity Search Agent

LangGraph-based agent that processes activity search requests.
Uses SerpAPI to search for activities, attractions, and things to do.
"""

import logging
import json
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.graph import StateGraph, MessagesState, END
from langgraph.graph.state import CompiledStateGraph
from ioa_observe.sdk.decorators import agent, graph

from agents.travel.serpapi_tools import search_activities

logger = logging.getLogger("lungo.activity.agent")


@agent(name="activity_search_agent")
class ActivitySearchAgent:
    """
    Activity Search Agent that uses SerpAPI to find activities and attractions.
    
    This agent:
    1. Receives activity search requests via A2A
    2. Parses the request to extract location
    3. Calls SerpAPI Google Local
    4. Returns formatted activity results
    """
    
    def __init__(self):
        """Initialize the activity search agent."""
        self.graph = self._build_graph()
    
    @graph(name="activity_search_graph")
    def _build_graph(self) -> CompiledStateGraph:
        """Build the LangGraph workflow for activity search."""
        workflow = StateGraph(MessagesState)
        
        workflow.add_node("search", self._search_activities_node)
        workflow.set_entry_point("search")
        workflow.add_edge("search", END)
        
        return workflow.compile()
    
    async def _search_activities_node(self, state: MessagesState) -> dict:
        """
        Process activity search request and return results.
        
        Expected message format:
        "Search activities in {location}"
        or "location:{location}"
        """
        # Get the latest human message
        user_msg = next(
            (m for m in reversed(state["messages"]) if isinstance(m, HumanMessage)),
            None
        )
        
        if not user_msg:
            return {"messages": [AIMessage(content="No activity search request received.")]}
        
        logger.info(f"Activity agent received request: {user_msg.content}")
        
        try:
            # Parse the request
            params = self._parse_request(user_msg.content)
            
            if not params.get("location"):
                return {"messages": [AIMessage(
                    content="Missing required parameter: location. Please provide a city or location."
                )]}
            
            # Search for activities using SerpAPI
            activities = await search_activities(
                location=params["location"],
                activity_type=params.get("activity_type", "things to do"),
            )
            
            
            # Format the response
            response = self._format_activities_response(activities, params)
            return {"messages": [AIMessage(content=response)]}
            
        except Exception as e:
            logger.error(f"Error searching activities: {e}")
            return {"messages": [AIMessage(content=json.dumps({"status": "error", "message": str(e)}))]}
    
    def _parse_request(self, message: str) -> dict:
        """
        Parse activity search request from message.
        
        Supports formats:
        - "location:San Jose activity_type:attractions"
        - "Search activities in San Jose"
        """
        params = {}
        
        # Try parsing key:value format
        parts = message.split()
        for part in parts:
            if ":" in part:
                key, value = part.split(":", 1)
                key = key.lower().strip()
                value = value.strip()
                
                if key in ["location", "city", "destination"]:
                    params["location"] = value.replace("_", " ")  # Handle underscores
                elif key in ["type", "activity_type", "category"]:
                    params["activity_type"] = value.replace("_", " ")
        
        return params
    
    def _format_activities_response(self, activities: list, params: dict) -> str:
        """Format activity results as a JSON string response."""
        import json
        
        # Return as JSON for the supervisor to parse
        response_data = {
            "status": "success",
            "location": params["location"],
            "activity_count": len(activities),
            "activities": activities[:10],  # Return top 10 activities
        }
        
        return json.dumps(response_data)
    
    async def ainvoke(self, message: str) -> str:
        """
        Invoke the activity search agent with a message.
        
        Args:
            message: Activity search request string
            
        Returns:
            Activity search results as JSON string
        """
        result = await self.graph.ainvoke({
            "messages": [HumanMessage(content=message)]
        })
        
        # Get the last AI message
        for msg in reversed(result.get("messages", [])):
            if isinstance(msg, AIMessage):
                return msg.content
        
        return "No response generated"
