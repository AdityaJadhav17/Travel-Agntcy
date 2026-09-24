# Copyright AGNTCY Contributors (https://github.com/agntcy)
# SPDX-License-Identifier: Apache-2.0

"""
Travel Supervisor Tools

A2A tools for communicating with Flight and Hotel search agents.
These tools use the A2A protocol to send requests and receive responses
via NATS transport.
"""

import logging
import json
from uuid import uuid4

from langchain_core.tools import tool, ToolException
from ioa_observe.sdk.decorators import tool as ioa_tool_decorator

from a2a.types import (
    SendMessageRequest,
    MessageSendParams,
    Message,
    Part,
    TextPart,
    Role,
)
from agntcy_app_sdk.semantic.a2a.protocol import A2AProtocol

from agents.flight.card import AGENT_CARD as FLIGHT_AGENT_CARD
from agents.hotel.card import AGENT_CARD as HOTEL_AGENT_CARD
from agents.activity.card import AGENT_CARD as ACTIVITY_AGENT_CARD
from agents.supervisors.travel.graph.shared import get_factory
from config.config import (
    DEFAULT_MESSAGE_TRANSPORT,
    TRANSPORT_SERVER_ENDPOINT,
    TRAVEL_HOTEL_CHECKIN_GAP_HOURS,
)
from agents.travel.travel_logic import find_cheapest_plan

logger = logging.getLogger("lungo.travel.supervisor.tools")


class A2AAgentError(ToolException):
    """Custom exception for A2A communication errors."""
    pass


# Create transport at module level (shared across all calls)
_transport = None

def _get_transport():
    """Get or create the transport instance."""
    global _transport
    if _transport is None:
        factory = get_factory()
        if factory:
            _transport = factory.create_transport(
                DEFAULT_MESSAGE_TRANSPORT,
                endpoint=TRANSPORT_SERVER_ENDPOINT,
                name="default/default/travel_supervisor",
            )
    return _transport


async def _send_a2a_message(agent_card, message: str) -> str:
    """
    Send a message to an A2A agent and wait for response.
    
    Args:
        agent_card: The target agent's card
        message: Message to send
        
    Returns:
        Response text from the agent
        
    Raises:
        A2AAgentError: If communication fails
    """
    factory = get_factory()
    if not factory:
        raise A2AAgentError("Factory not initialized")
    
    transport = _get_transport()
    if not transport:
        raise A2AAgentError("Transport not initialized")
    
    try:
        # Create A2A client
        client = await factory.create_client(
            "A2A",
            agent_topic=A2AProtocol.create_agent_topic(agent_card),
            transport=transport,
        )

        # Create request (matching the exact pattern from original code)
        request = SendMessageRequest(
            id=str(uuid4()),
            params=MessageSendParams(
                message=Message(
                    messageId=str(uuid4()),
                    role=Role.user,
                    parts=[Part(TextPart(text=message))],
                ),
            )
        )
        
        # Send message and get response
        logger.info(f"Sending A2A message to {agent_card.name}...")
        response = await client.send_message(request)
        logger.info("Response received from A2A agent %s", agent_card.name)
        
        # Parse response (matching the exact pattern from original code)
        error = getattr(response.root, "error", None)
        if error:
            raise A2AAgentError(f"Error from '{agent_card.name}': {error.message}")
        result = getattr(response.root, "result", None)
        parts = getattr(result, "parts", None)
        if parts:
            part = parts[0].root
            if hasattr(part, "text"):
                return part.text.strip()
            else:
                raise A2AAgentError(f"Agent '{agent_card.name}' returned result without text content.")
        else:
            logger.error(f"Unknown response type from '{agent_card.name}'.")
            raise A2AAgentError(f"Unknown response type from '{agent_card.name}'.")
            
    except A2AAgentError:
        raise  # Re-raise our custom exceptions
    except Exception as e:
        logger.error(f"Failed to communicate with '{agent_card.name}': {e}")
        raise A2AAgentError(f"Failed to communicate with '{agent_card.name}'. Details: {e}")


# ============================================================================
# Internal helper functions (NOT tools) - these can be called directly
# The @tool decorated versions below are for LangGraph tool binding only
# ============================================================================

async def _search_flights_internal(
    origin: str,
    destination: str,
    outbound_date: str,
    return_date: str = None,
    is_one_way: bool = False,
) -> str:
    """
    Internal function to search for flights using the Flight Search Agent via A2A.
    This function can be called directly (not wrapped as a LangChain tool).
    
    Supports both round-trip and one-way flights:
    - Round-trip: origin, destination, outbound_date, return_date
    - One-way: origin, destination, outbound_date (no return_date, is_one_way=True)
    
    Args:
        origin: Departure airport code (e.g., "LAX")
        destination: Arrival airport code (e.g., "NRT")
        outbound_date: Departure date (YYYY-MM-DD)
        return_date: Return date (YYYY-MM-DD) - optional for one-way
        is_one_way: If True, search for one-way flights only
        
    Returns:
        JSON string with flight results
    """
    trip_type = "one-way" if is_one_way else "round-trip"
    logger.info(f"Sending A2A request to Flight Agent ({trip_type}): {origin} -> {destination}")
    
    # Format message for the flight agent
    # For one-way flights, include type:oneway flag and omit return date
    if is_one_way:
        message = f"origin:{origin} destination:{destination} outbound:{outbound_date} type:oneway"
    else:
        message = f"origin:{origin} destination:{destination} outbound:{outbound_date} return:{return_date}"
    
    try:
        result = await _send_a2a_message(FLIGHT_AGENT_CARD, message)
        return result
    except A2AAgentError as e:
        logger.error(f"Flight search A2A error: {e}")
        return json.dumps({"status": "error", "message": str(e)})


async def _search_hotels_internal(
    location: str,
    check_in_date: str,
    check_out_date: str,
) -> str:
    """
    Internal function to search for hotels using the Hotel Search Agent via A2A.
    This function can be called directly (not wrapped as a LangChain tool).
    
    Args:
        location: City or area name (e.g., "Tokyo")
        check_in_date: Check-in date (YYYY-MM-DD)
        check_out_date: Check-out date (YYYY-MM-DD)
        
    Returns:
        JSON string with hotel results
    """
    logger.info(f"Sending A2A request to Hotel Agent: {location}")
    
    # Format message for the hotel agent
    message = f"location:{location} check_in:{check_in_date} check_out:{check_out_date}"
    
    try:
        result = await _send_a2a_message(HOTEL_AGENT_CARD, message)
        return result
    except A2AAgentError as e:
        logger.error(f"Hotel search A2A error: {e}")
        return json.dumps({"status": "error", "message": str(e)})


@tool
@ioa_tool_decorator(name="search_flights_a2a")
async def search_flights_a2a(
    origin: str,
    destination: str,
    outbound_date: str,
    return_date: str,
) -> str:
    """
    Search for flights using the Flight Search Agent via A2A.
    
    Args:
        origin: Departure airport code (e.g., "LAX")
        destination: Arrival airport code (e.g., "NRT")
        outbound_date: Departure date (YYYY-MM-DD)
        return_date: Return date (YYYY-MM-DD)
        
    Returns:
        JSON string with flight results
    """
    logger.info(f"Sending A2A request to Flight Agent: {origin} -> {destination}")
    
    # Format message for the flight agent
    message = f"origin:{origin} destination:{destination} outbound:{outbound_date} return:{return_date}"
    
    try:
        result = await _send_a2a_message(FLIGHT_AGENT_CARD, message)
        return result
    except A2AAgentError as e:
        logger.error(f"Flight search A2A error: {e}")
        return json.dumps({"status": "error", "message": str(e)})


@tool
@ioa_tool_decorator(name="search_hotels_a2a")
async def search_hotels_a2a(
    location: str,
    check_in_date: str,
    check_out_date: str,
) -> str:
    """
    Search for hotels using the Hotel Search Agent via A2A.
    
    Args:
        location: City or area name (e.g., "Tokyo")
        check_in_date: Check-in date (YYYY-MM-DD)
        check_out_date: Check-out date (YYYY-MM-DD)
        
    Returns:
        JSON string with hotel results
    """
    logger.info(f"Sending A2A request to Hotel Agent: {location}")
    
    # Format message for the hotel agent
    message = f"location:{location} check_in:{check_in_date} check_out:{check_out_date}"
    
    try:
        result = await _send_a2a_message(HOTEL_AGENT_CARD, message)
        return result
    except A2AAgentError as e:
        logger.error(f"Hotel search A2A error: {e}")
        return json.dumps({"status": "error", "message": str(e)})


async def get_flights_via_a2a(
    origin: str,
    destination: str,
    outbound_date: str,
    return_date: str = None,
    is_one_way: bool = False,
) -> list:
    """
    Get flights via A2A and parse the response.
    
    This is the main function called by the Travel Supervisor graph
    to search for flights through the Flight Agent.
    
    Supports both round-trip and one-way flights:
    - Round-trip: provide outbound_date and return_date
    - One-way: provide outbound_date only, set is_one_way=True
    
    Note: Uses _search_flights_internal (not the @tool decorated version)
    to avoid the 'StructuredTool object is not callable' error.
    
    Returns:
        List of flight dictionaries
    """
    # Use the internal function (not the @tool decorated version)
    result_json = await _search_flights_internal(
        origin, destination, outbound_date, return_date, is_one_way
    )
    
    try:
        result = json.loads(result_json)
        if result.get("status") == "success":
            return result.get("flights", [])
        else:
            raise A2AAgentError(result.get("message") or "Flight agent search failed")
    except json.JSONDecodeError:
        raise A2AAgentError("Flight agent returned an invalid response") from None


async def get_hotels_via_a2a(location: str, check_in_date: str, check_out_date: str) -> list:
    """
    Get hotels via A2A and parse the response.
    
    This is the main function called by the Travel Supervisor graph
    to search for hotels through the Hotel Agent.
    
    Note: Uses _search_hotels_internal (not the @tool decorated version)
    to avoid the 'StructuredTool object is not callable' error.
    
    Returns:
        List of hotel dictionaries
    """
    # Use the internal function (not the @tool decorated version)
    result_json = await _search_hotels_internal(location, check_in_date, check_out_date)
    
    try:
        result = json.loads(result_json)
        if result.get("status") == "success":
            return result.get("hotels", [])
        else:
            raise A2AAgentError(result.get("message") or "Hotel agent search failed")
    except json.JSONDecodeError:
        raise A2AAgentError("Hotel agent returned an invalid response") from None


# =============================================================================
# Activity Search Functions (A2A communication with Activity Agent)
# =============================================================================

async def _search_activities_internal(location: str, activity_type: str = "things to do") -> str:
    """
    Search for activities using the Activity Search Agent via A2A.
    
    Args:
        location: City or area name (e.g., "San Jose, CA", "Tokyo")
        activity_type: Type of activities to search for (default: "things to do")
        
    Returns:
        JSON string with activity results
    """
    logger.info(f"Sending A2A request to Activity Agent: {location}")
    
    # Format message for the activity agent
    # Replace spaces with underscores in location to handle parsing
    location_formatted = location.replace(" ", "_")
    message = f"location:{location_formatted} type:{activity_type.replace(' ', '_')}"
    
    try:
        result = await _send_a2a_message(ACTIVITY_AGENT_CARD, message)
        return result
    except A2AAgentError as e:
        logger.error(f"Activity search A2A error: {e}")
        return json.dumps({"status": "error", "message": str(e)})


async def get_activities_via_a2a(location: str, activity_type: str = "things to do") -> list:
    """
    Get activities via A2A and parse the response.
    
    This is the main function called by the Travel Supervisor graph
    to search for activities through the Activity Agent.
    
    Args:
        location: City name (e.g., "San Jose, CA", "Tokyo, Japan")
        activity_type: Type of activities (default: "things to do")
    
    Returns:
        List of activity dictionaries with name, rating, address, etc.
    """
    # Use the internal function (not the @tool decorated version)
    result_json = await _search_activities_internal(location, activity_type)
    
    try:
        result = json.loads(result_json)
        if result.get("status") == "success":
            return result.get("activities", [])
        else:
            raise A2AAgentError(result.get("message") or "Activity agent search failed")
    except json.JSONDecodeError:
        raise A2AAgentError("Activity agent returned an invalid response") from None


@tool
@ioa_tool_decorator(name="find_best_travel_plan")
async def find_best_travel_plan(
    origin: str,
    destination: str,
    start_date: str,
    end_date: str,
    destination_city: str = None,
) -> str:
    """
    Find the cheapest flight + hotel combination for a trip using A2A agents.
    
    This tool coordinates with Flight and Hotel agents via A2A to find
    the optimal combination considering:
    - Total price (flight + hotel)
    - Timing constraints (hotel check-in must be after flight arrival + buffer)
    
    Args:
        origin: Departure airport code (e.g., "LAX", "JFK")
        destination: Arrival airport code (e.g., "CDG", "NRT") - used for flight search
        start_date: Trip start date in YYYY-MM-DD format
        end_date: Trip end date in YYYY-MM-DD format
        destination_city: City name for hotel search (e.g., "Paris, France", "Tokyo, Japan")
                         If not provided, uses destination (which may fail for hotel searches)
    
    Returns:
        Detailed summary of the best travel plan found
    """
    # Use city name for hotels, airport code for flights
    hotel_location = destination_city or destination
    logger.info(f"Tool: Finding best plan via A2A: {origin} -> {destination}, hotels in {hotel_location}, {start_date} to {end_date}")
    
    try:
        # Search for flights via A2A using internal functions
        # (not the @tool decorated versions to avoid 'not callable' error)
        flight_result = await _search_flights_internal(origin, destination, start_date, end_date)
        # Use city name for hotel search (Google Hotels needs city names, not airport codes)
        hotel_result = await _search_hotels_internal(hotel_location, start_date, end_date)
        
        # Parse flight results
        try:
            flight_data = json.loads(flight_result)
            flights = flight_data.get("flights", []) if flight_data.get("status") == "success" else []
        except json.JSONDecodeError:
            flights = []
        
        # Parse hotel results
        try:
            hotel_data = json.loads(hotel_result)
            hotels = hotel_data.get("hotels", []) if hotel_data.get("status") == "success" else []
        except json.JSONDecodeError:
            hotels = []
        
        if not flights:
            return f"No flights found from {origin} to {destination}. The Flight Agent may be unavailable."
        
        if not hotels:
            return f"No hotels found in {hotel_location}. The Hotel Agent may be unavailable."
        
        # Find cheapest valid combination
        plan = find_cheapest_plan(flights, hotels)
        
        if not plan:
            return (
                f"Could not find a valid flight + hotel combination. "
                f"This may happen if hotel check-in times don't align with flight arrivals. "
                f"Try adjusting your dates."
            )
        
        # Format the result
        flight = plan["flight"]
        hotel = plan["hotel"]
        
        result = f"""
🎉 **Best Travel Plan Found!**

**Total Cost: ${plan['total_price']:.2f}**

✈️ **Flight Details:**
- Airline: {flight.get('airline', 'Unknown')}
- Price: ${flight.get('price', 0):.2f}
- Departure: {flight.get('departure_time', 'N/A')}
- Arrival: {flight.get('arrival_time', 'N/A')}
- Stops: {flight.get('stops', 0)}

🏨 **Hotel Details:**
- Hotel: {hotel.get('name', 'Unknown Hotel')}
- Price: ${hotel.get('price', 0):.2f}
- Rating: {hotel.get('rating', 'N/A')}/5
- Check-in Time: {hotel.get('check_in_time', '15:00')}

📋 **Trip Summary:**
- Route: {origin} → {destination}
- Dates: {start_date} to {end_date}
- Arrival at destination: {plan.get('arrival_time', 'N/A')}
- Buffer time to hotel: {plan.get('gap_hours', TRAVEL_HOTEL_CHECKIN_GAP_HOURS)} hours
"""
        return result.strip()
        
    except Exception as e:
        logger.error(f"Error finding best travel plan: {e}")
        return f"Error finding travel plan: {str(e)}"
