# Copyright AGNTCY Contributors (https://github.com/agntcy)
# SPDX-License-Identifier: Apache-2.0

"""
Hotel Search Agent

LangGraph-based agent that processes hotel search requests.
Uses SerpAPI to search for hotels and returns formatted results.
"""

import logging
import json
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.graph import StateGraph, MessagesState, END
from langgraph.graph.state import CompiledStateGraph
from ioa_observe.sdk.decorators import agent, graph

from agents.travel.serpapi_tools import search_hotels
from agents.travel.party import party_from_message

logger = logging.getLogger("lungo.hotel.agent")


@agent(name="hotel_search_agent")
class HotelSearchAgent:
    """
    Hotel Search Agent that uses SerpAPI to find hotels.
    
    This agent:
    1. Receives hotel search requests via A2A
    2. Parses the request to extract location and dates
    3. Calls SerpAPI Google Hotels
    4. Returns formatted hotel results
    """
    
    def __init__(self):
        """Initialize the hotel search agent."""
        self.graph = self._build_graph()
    
    @graph(name="hotel_search_graph")
    def _build_graph(self) -> CompiledStateGraph:
        """Build the LangGraph workflow for hotel search."""
        workflow = StateGraph(MessagesState)
        
        workflow.add_node("search", self._search_hotels_node)
        workflow.set_entry_point("search")
        workflow.add_edge("search", END)
        
        return workflow.compile()
    
    async def _search_hotels_node(self, state: MessagesState) -> dict:
        """
        Process hotel search request and return results.
        
        Expected message format:
        "Search hotels in {location} from {check_in} to {check_out}"
        """
        # Get the latest human message
        user_msg = next(
            (m for m in reversed(state["messages"]) if isinstance(m, HumanMessage)),
            None
        )
        
        if not user_msg:
            return {"messages": [AIMessage(content="No hotel search request received.")]}
        
        logger.info(f"Hotel agent received request: {user_msg.content}")
        
        try:
            # Parse the request
            params = self._parse_request(user_msg.content)
            
            if not all([params.get("location"), params.get("check_in"), params.get("check_out")]):
                return {"messages": [AIMessage(
                    content="Missing required parameters. Please provide: location, check_in_date, check_out_date"
                )]}
            
            # Search for hotels using SerpAPI
            hotels = await search_hotels(
                location=params["location"],
                check_in_date=params["check_in"],
                check_out_date=params["check_out"],
                party=party_from_message(user_msg.content),
            )
            
            
            # Format the response
            response = self._format_hotels_response(hotels, params)
            return {"messages": [AIMessage(content=response)]}
            
        except Exception as e:
            logger.error(f"Error searching hotels: {e}")
            return {"messages": [AIMessage(content=json.dumps({"status": "error", "message": str(e)}))]}
    
    def _parse_request(self, message: str) -> dict:
        """
        Parse hotel search request from message.
        
        Supports formats:
        - "location:San Diego check_in:2026-01-15 check_out:2026-01-22"
        - "location:Tokyo check_in:2026-01-15 check_out:2026-01-22"
        
        Handles multi-word locations like "San Diego", "New York", "Las Vegas"
        """
        import re
        params = {}
        
        # Use regex to parse key:value pairs, handling multi-word values
        # Pattern: key:value where value continues until the next key: or end
        # This properly handles "location:San Diego check_in:2026-03-13"
        
        # Extract location (can have spaces)
        location_match = re.search(r'location:([^:]+?)(?:\s+(?:check_in|check_out|checkin|checkout|start|end):|\s*$)', message, re.IGNORECASE)
        if location_match:
            params["location"] = location_match.group(1).strip()
        
        # Extract check_in date
        check_in_match = re.search(r'(?:check_in|checkin|start):(\S+)', message, re.IGNORECASE)
        if check_in_match:
            params["check_in"] = check_in_match.group(1).strip()
        
        # Extract check_out date
        check_out_match = re.search(r'(?:check_out|checkout|end):(\S+)', message, re.IGNORECASE)
        if check_out_match:
            params["check_out"] = check_out_match.group(1).strip()
        
        return params
    
    def _format_hotels_response(self, hotels: list, params: dict) -> str:
        """Format hotel results as a string response."""
        import json
        
        # Return as JSON for the supervisor to parse
        response_data = {
            "status": "success",
            "location": params["location"],
            "hotel_count": len(hotels),
            "hotels": hotels[:10],  # Return top 10 hotels
        }
        
        return json.dumps(response_data)
    
    async def ainvoke(self, message: str) -> str:
        """
        Invoke the hotel search agent with a message.
        
        Args:
            message: Hotel search request string
            
        Returns:
            Hotel search results as JSON string
        """
        result = await self.graph.ainvoke({
            "messages": [HumanMessage(content=message)]
        })
        
        # Get the last AI message
        for msg in reversed(result.get("messages", [])):
            if isinstance(msg, AIMessage):
                return msg.content
        
        return "No response generated"
