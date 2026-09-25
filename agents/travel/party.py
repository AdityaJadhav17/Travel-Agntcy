"""Validated traveler counts shared by the supervisor, A2A agents and providers."""

import json
from typing import Annotated

from pydantic import BaseModel, Field

Age = Annotated[int, Field(strict=True, ge=0, le=17)]


class TravelParty(BaseModel):
    adults: int = Field(default=1, strict=True, ge=1, le=9, description="Adult travelers age 18+, default one only for a new trip; preserve saved count")
    children: int = Field(default=0, strict=True, ge=0, le=8, description="Travelers under 18, including infants; preserve saved count")
    children_ages: list[Age] = Field(default_factory=list, max_length=8, description="Each child's age at travel, including infants; never invent ages. Empty if unknown, clear when children removed")
    rooms: int = Field(default=1, strict=True, ge=1, le=9, description="Requested hotel rooms; preserve even when multiple rooms are unsupported")

    def question(self, search_type):
        if search_type == "activity_only":
            return None
        if self.adults + self.children > 9:
            return "I can search for up to 9 travelers at a time. How many adults and children should I include?"
        if len(self.children_ages) != self.children:
            if self.children == 0:
                return "I have child ages but the count is zero. Please correct the child count or remove the ages."
            return f"What will each of the {self.children} children's ages be at the time of travel? Please give one age per child, or correct the child count."
        if search_type in ("full_trip", "flight_only") and any(age < 2 for age in self.children_ages):
            return "Infant flight fares depend on lap or separate-seat arrangements, which this search does not support yet. I can search hotels only with your infant included; would you like that?"
        if search_type in ("full_trip", "hotel_only") and self.rooms != 1:
            return f"I saved your request for {self.rooms} rooms. My hotel search supports one room only, so I cannot verify multi-room availability or a total price. Would you like a one-room search or flights only?"
        return None

    def require_supported(self, search_type):
        if question := self.question(search_type):
            raise ValueError(question)

    def flight_parameters(self):
        self.require_supported("flight_only")
        return {"adults": self.adults + sum(age >= 12 for age in self.children_ages),
                "children": sum(2 <= age < 12 for age in self.children_ages)}

    def hotel_parameters(self):
        self.require_supported("hotel_only")
        result = {"adults": self.adults, "children": self.children}
        if self.children:
            result["children_ages"] = ",".join(str(max(1, age)) for age in self.children_ages)
        return result

    def label(self, search_type):
        result = f"Travelers: {self.adults} adult{'s' if self.adults != 1 else ''}, {self.children} {'children' if self.children != 1 else 'child'}"
        if self.children_ages:
            result += " (ages " + ", ".join(map(str, self.children_ages)) + ")"
        if search_type in ("full_trip", "hotel_only"):
            result += f"; {self.rooms} room{'s' if self.rooms != 1 else ''}"
        return result + ". Prices are the provider's returned quotes for this search; confirm occupancy and the final price before booking."


def party_from_message(message):
    """New requests append a compact JSON party; older requests use explicit defaults."""
    marker = " party:"
    if marker not in message:
        return TravelParty()
    return TravelParty.model_validate(json.loads(message.split(marker, 1)[1]))
