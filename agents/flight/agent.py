# Copyright AGNTCY Contributors (https://github.com/agntcy)
# SPDX-License-Identifier: Apache-2.0

"""
Flight Search Agent

LangGraph-based agent that processes flight search requests.
Uses SerpAPI to search for flights and returns formatted results.
"""

import logging
import json
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.graph import StateGraph, MessagesState, END
from langgraph.graph.state import CompiledStateGraph
from ioa_observe.sdk.decorators import agent, graph

from agents.travel.serpapi_tools import search_flights

logger = logging.getLogger("lungo.flight.agent")


@agent(name="flight_search_agent")
class FlightSearchAgent:
    """
    Flight Search Agent that uses SerpAPI to find flights.
    
    This agent:
    1. Receives flight search requests via A2A
    2. Parses the request to extract origin, destination, dates
    3. Calls SerpAPI Google Flights
    4. Returns formatted flight results
    """
    
    def __init__(self):
        """Initialize the flight search agent."""
        self.graph = self._build_graph()
    
    @graph(name="flight_search_graph")
    def _build_graph(self) -> CompiledStateGraph:
        """Build the LangGraph workflow for flight search."""
        workflow = StateGraph(MessagesState)
        
        workflow.add_node("search", self._search_flights_node)
        workflow.set_entry_point("search")
        workflow.add_edge("search", END)
        
        return workflow.compile()
    
    async def _search_flights_node(self, state: MessagesState) -> dict:
        """
        Process flight search request and return results.
        
        Supports both round-trip and one-way flights:
        - Round-trip: "origin:LAX destination:NRT outbound:2026-01-15 return:2026-01-22"
        - One-way: "origin:LAX destination:NRT outbound:2026-01-15 type:oneway"
        """
        # Get the latest human message
        user_msg = next(
            (m for m in reversed(state["messages"]) if isinstance(m, HumanMessage)),
            None
        )
        
        if not user_msg:
            return {"messages": [AIMessage(content="No flight search request received.")]}
        
        logger.info(f"Flight agent received request: {user_msg.content}")
        
        try:
            # Parse the request
            params = self._parse_request(user_msg.content)
            is_one_way = params.get("is_one_way", False)
            
            # Check required parameters
            # For one-way: origin, destination, outbound_date
            # For round-trip: also need return_date
            required_present = all([
                params.get("origin"), 
                params.get("destination"), 
                params.get("outbound_date")
            ])
            
            if not required_present:
                return {"messages": [AIMessage(
                    content="Missing required parameters. Please provide: origin, destination, outbound_date"
                )]}
            
            # For round-trip, also need return_date
            if not is_one_way and not params.get("return_date"):
                return {"messages": [AIMessage(
                    content="Missing return_date for round-trip. Add 'type:oneway' for one-way flights."
                )]}
            
            trip_type = "one-way" if is_one_way else "round-trip"
            logger.info(f"Searching {trip_type} flights: {params['origin']} -> {params['destination']}")
            
            # Search for flights using SerpAPI
            # For one-way, pass outbound_date as return_date too (the API handles type:2)
            flights = await search_flights(
                origin=params["origin"],
                destination=params["destination"],
                outbound_date=params["outbound_date"],
                return_date=params.get("return_date") or params["outbound_date"],
                include_return_flights=not is_one_way,  # Don't fetch return flights for one-way
            )
            
            
            # Format the response
            response = self._format_flights_response(flights, params)
            return {"messages": [AIMessage(content=response)]}
            
        except Exception as e:
            logger.error(f"Error searching flights: {e}")
            return {"messages": [AIMessage(content=json.dumps({"status": "error", "message": str(e)}))]}
    
    def _parse_request(self, message: str) -> dict:
        """
        Parse flight search request from message.
        
        Supports formats:
        - Round-trip: "origin:LAX destination:NRT outbound:2026-01-15 return:2026-01-22"
        - One-way: "origin:LAX destination:NRT outbound:2026-01-15 type:oneway"
        - JSON-like format
        """
        params = {
            "is_one_way": False  # Default to round-trip
        }
        
        # Try parsing key:value format
        parts = message.split()
        for part in parts:
            if ":" in part:
                key, value = part.split(":", 1)
                key = key.lower().strip()
                value = value.strip()
                
                if key in ["origin", "from"]:
                    params["origin"] = value
                elif key in ["destination", "to", "dest"]:
                    params["destination"] = value
                elif key in ["outbound", "outbound_date", "depart", "start"]:
                    params["outbound_date"] = value
                elif key in ["return", "return_date", "end"]:
                    params["return_date"] = value
                elif key == "type" and value.lower() in ["oneway", "one-way", "single"]:
                    params["is_one_way"] = True
        
        return params
    
    def _format_flights_response(self, flights: list, params: dict) -> str:
        """Format flight results as a string response."""
        import json
        
        # Return as JSON for the supervisor to parse
        response_data = {
            "status": "success",
            "origin": params["origin"],
            "destination": params["destination"],
            "flight_count": len(flights),
            "flights": flights[:10],  # Return top 10 flights
        }
        
        return json.dumps(response_data)
    
    async def ainvoke(self, message: str) -> str:
        """
        Invoke the flight search agent with a message.
        
        Args:
            message: Flight search request string
            
        Returns:
            Flight search results as JSON string
        """
        result = await self.graph.ainvoke({
            "messages": [HumanMessage(content=message)]
        })
        
        # Get the last AI message
        for msg in reversed(result.get("messages", [])):
            if isinstance(msg, AIMessage):
                return msg.content
        
        return "No response generated"
