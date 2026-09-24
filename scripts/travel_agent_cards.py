"""Travel agents eligible for A2A directory discovery (no network calls)."""

from a2a.types import AgentCard

from agents.activity.card import AGENT_CARD as ACTIVITY_CARD
from agents.flight.card import AGENT_CARD as FLIGHT_CARD
from agents.hotel.card import AGENT_CARD as HOTEL_CARD


def get_travel_agent_cards() -> list[AgentCard]:
    # The supervisor exposes a custom REST API, not an A2A server.
    return [FLIGHT_CARD, HOTEL_CARD, ACTIVITY_CARD]
