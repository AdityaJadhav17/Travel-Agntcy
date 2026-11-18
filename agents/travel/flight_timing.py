"""Airport-local flight windows shared by conversation and provider search."""

from datetime import time
import re
from typing import Literal

from pydantic import BaseModel, Field, model_validator


PERIODS = {
    "early morning": ("00:00", "06:00"),
    "morning": ("06:00", "12:00"),
    "afternoon": ("12:00", "18:00"),
    "evening": ("18:00", "24:00"),
}
NAMED_WINDOWS = {
    **PERIODS,
    "late evening": ("20:00", "24:00"),
    "night": ("22:00", "06:00"),
    "at night": ("22:00", "06:00"),
    "red-eye": ("22:00", "06:00"),
    "red eye": ("22:00", "06:00"),
    "redeye": ("22:00", "06:00"),
}
TIME_CLARIFICATION = "What local time should I use"


def local_minutes(value: object) -> int | None:
    if not isinstance(value, str):
        return None
    clock = value.strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}[T ]", clock):
        clock = clock[11:]
    if not re.match(r"^(?:[01]\d|2[0-3]):[0-5]\d", clock):
        return None
    try:
        parsed = time.fromisoformat(clock.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.hour * 60 + parsed.minute


class LocalWindow(BaseModel):
    start: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    end: str = Field(pattern=r"^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$")

    @model_validator(mode="after")
    def validate_window(self):
        if self.start == self.end:
            raise ValueError("Flight time window must have a distinct start and end")
        return self

    def matches(self, value: object) -> bool:
        minute = local_minutes(value)
        if minute is None:
            return False
        if self.start > self.end:
            return minute >= local_minutes(self.start) or minute < local_minutes(self.end)
        end = 1440 if self.end == "24:00" else local_minutes(self.end)
        return local_minutes(self.start) <= minute < end

    def provider_range(self) -> str:
        if self.start > self.end:
            return "0,23"
        end = 1440 if self.end == "24:00" else local_minutes(self.end)
        return f"{local_minutes(self.start) // 60},{(end - 1) // 60}"


class ClockClarification(BaseModel):
    leg: Literal["outbound", "return"]
    event: Literal["departure", "arrival"]
    direction: Literal["before", "after"]
    clock: str = Field(pattern=r"^(?:[1-9]|1[0-2])(?::[0-5]\d)?$")
    compare_dates: bool = False

    def question(self) -> str:
        return f"{TIME_CLARIFICATION}, {self.clock} a.m. or {self.clock} p.m.?"

    def resolve(self, text: str, current: "FlightTiming") -> "FlightTiming | None":
        reply = text.lower().strip(" .!?")
        match = re.fullmatch(r"(?:(\d{1,2}(?::[0-5]\d)?)\s*)?([ap])\.?m\.?(?: please)?", reply)
        if not match:
            return None
        bound = _clock_bound(f"{match[1] or self.clock} {match[2]}m")
        if bound is None:
            return None
        window = _bounded_window(bound, self.direction)
        return _apply_edit(current, self.leg, {f"{self.leg}_{self.event}": window})


class FlightTiming(BaseModel):
    outbound_departure: LocalWindow | None = None
    outbound_departure_fallback: LocalWindow | None = None
    outbound_arrival: LocalWindow | None = None
    return_departure: LocalWindow | None = None
    return_arrival: LocalWindow | None = None
    compare_departures: Literal["outbound", "return"] | None = None
    comparison_periods: list[Literal["early morning", "morning", "afternoon", "evening"]] = Field(
        default_factory=list, max_length=4,
    )

    def has_return_timing(self) -> bool:
        return bool(self.return_departure or self.return_arrival or self.compare_departures == "return")

    def provider_filters(self) -> dict[str, str]:
        filters = {}
        for leg in ("outbound", "return"):
            departure = getattr(self, f"{leg}_departure")
            arrival = getattr(self, f"{leg}_arrival")
            if leg == "outbound" and departure and self.outbound_departure_fallback:
                # Request a superset and check the two windows exactly against the fare.
                alternate = self.outbound_departure_fallback
                if departure.start > departure.end or alternate.start > alternate.end:
                    departure = LocalWindow(start="00:00", end="24:00")
                else:
                    departure = LocalWindow(start=min(departure.start, alternate.start),
                                            end=max(departure.end, alternate.end))
            if arrival:
                hours = f"{departure.provider_range() if departure else '0,23'},{arrival.provider_range()}"
            elif departure:
                hours = departure.provider_range()
            else:
                continue
            filters[f"{leg}_times"] = hours
        return filters

    def matches_leg(self, quote: dict, leg: str) -> bool:
        if self.compare_departures == leg:
            period = departure_period(quote)
            if not period or (self.comparison_periods and period not in self.comparison_periods):
                return False
        departure = getattr(self, f"{leg}_departure")
        arrival = getattr(self, f"{leg}_arrival")
        fallback = self.outbound_departure_fallback if leg == "outbound" else None
        return (
            (not departure or departure.matches(quote.get("departure_time"))
             or bool(fallback and fallback.matches(quote.get("departure_time"))))
            and (not arrival or arrival.matches(quote.get("arrival_time")))
        )

    def preferred_outbound(self, quote: dict) -> bool:
        return (not self.outbound_departure_fallback or not self.outbound_departure
                or self.outbound_departure.matches(quote.get("departure_time")))

    def prefer_matching_flights(self, quotes: list[dict]) -> list[dict]:
        if not self.outbound_departure_fallback:
            return quotes
        preferred = [quote for quote in quotes if self.preferred_outbound(quote)]
        return preferred or quotes

    def window_summary(self) -> str:
        labels = []
        for leg in ("outbound", "return"):
            for event in ("departure", "arrival"):
                if window := getattr(self, f"{leg}_{event}"):
                    label = f"{leg} {event} {window.start}–{window.end}"
                    if window.start > window.end:
                        label += " (across midnight)"
                    labels.append(label)
                    if leg == "outbound" and event == "departure" and self.outbound_departure_fallback:
                        alternate = self.outbound_departure_fallback
                        labels.append(f"accepted fallback {alternate.start}–{alternate.end}")
        return ", ".join(labels)


class OutboundSelection(BaseModel):
    """Stored itinerary evidence, with no provider token or price."""

    airline: str = Field(min_length=1, max_length=160)
    departure_time: str = Field(min_length=1, max_length=80)
    arrival_time: str = Field(min_length=1, max_length=80)
    departure_code: str = Field(min_length=3, max_length=8)
    arrival_code: str = Field(min_length=3, max_length=8)
    stops: int = Field(ge=0)
    duration_minutes: int = Field(default=0, ge=0)
    flight_numbers: list[str] = Field(default_factory=list, max_length=20)

    def matches(self, quote: dict) -> bool:
        return all(quote.get(field) == value for field, value in self.model_dump().items()
                   if field not in ("duration_minutes", "flight_numbers") or value)


class FlightSearchTiming(FlightTiming):
    pinned_outbound: OutboundSelection | None = None


def timing_from_message(message: str) -> FlightSearchTiming | None:
    match = re.search(r"(?:^|\s)timing:", message)
    if match:
        payload = message[match.end():].partition(" party:")[0]
        return FlightSearchTiming.model_validate_json(payload)
    return None


def simple_timing_edit(text: str, current: FlightTiming) -> FlightTiming | ClockClarification | str | None:
    """Recognize short, self-contained edits without interpreting a new itinerary."""
    text = " ".join(text.lower().strip(" .?!").split())
    text = re.sub(r"^(?:how about|what about|show me|try|make it|actually,?)\s+", "", text)
    leg = "outbound"
    return_leg = r"^(?:return|inbound)\s+|\s(?:for|on) (?:the )?return$| on the way back$"
    if re.search(return_leg, text):
        leg = "return"
        text = re.sub(return_leg, "", text)
    if text in {"any time", "anytime", "no time preference", "clear time preferences"}:
        if leg == "outbound":
            return FlightTiming()
        changes = {"return_departure": None, "return_arrival": None}
    else:
        changes = _timing_edit(text, leg)
        if not isinstance(changes, dict):
            return changes
    return _apply_edit(current, leg, changes)


def _apply_edit(current: FlightTiming, leg: str, changes: dict) -> FlightTiming:
    if current.compare_departures == leg and f"{leg}_departure" in changes and "compare_departures" not in changes:
        changes.update(compare_departures=None, comparison_periods=[])
    if "outbound_departure" in changes and "outbound_departure_fallback" not in changes:
        changes["outbound_departure_fallback"] = None
    return current.model_copy(update=changes)


def _timing_edit(text: str, leg: str) -> dict | ClockClarification | str | None:
    if leg == "outbound":
        soft = re.fullmatch(r"(?:prefer )?(early morning|morning|afternoon|evening)(?: flights?)?"
                            r"(?: if possible)?(?:,? but| or) "
                            r"(early morning|morning|afternoon|evening|any time)(?: is fine| is okay)", text)
        if soft:
            alternate = PERIODS.get(soft[2], ("00:00", "24:00"))
            return {"outbound_departure": _named_window(soft[1]),
                    "outbound_departure_fallback": LocalWindow(start=alternate[0], end=alternate[1])}
    comparison = re.fullmatch(
        r"(?:compare )?(early morning|morning|afternoon|evening) (?:vs\.?|versus|or|and) "
        r"(early morning|morning|afternoon|evening)(?: flights?)?", text,
    )
    if comparison:
        return {f"{leg}_departure": None, "compare_departures": leg,
                "comparison_periods": list(dict.fromkeys(comparison.groups()))}
    if re.fullmatch(
        r"(?:(?:compare|show me) )?(?:different (?:departure )?times?(?: of (?:the )?day)?|"
        r"other (?:departure )?times?|a range of (?:departure )?times)", text,
    ):
        return {f"{leg}_departure": None, "compare_departures": leg, "comparison_periods": []}
    text = re.sub(r"(?: instead| please)+$", "", text)
    text = re.sub(r"^(?:(?:flights?|departures?) )?(?:in|during) the |^the |^only | (?:flights?|departures?|ones)$", "", text)
    if text in NAMED_WINDOWS:
        return {f"{leg}_departure": _named_window(text)}
    interval = re.fullmatch(r"(?:(leave|depart|arrive|land) )?between (.+) and (.+)", text)
    if interval:
        event, left, right = interval.groups()
        start, end = _clock_bound(left), _clock_bound(right)
        if start and end and start != end:
            field = "arrival" if event in {"arrive", "land"} else "departure"
            return {f"{leg}_{field}": LocalWindow(start=start, end=end)}
    clock = re.fullmatch(r"(?:(leave|depart|arrive|land) )?(after|before) (.+)", text)
    if clock:
        event, direction, raw_time = clock.groups()
        field = "arrival" if event in {"arrive", "land"} else "departure"
        if (bound := _clock_bound(raw_time)) is not None:
            return {f"{leg}_{field}": _bounded_window(bound, direction)}
        if re.fullmatch(r"(?:[1-9]|1[0-2])(?::[0-5]\d)?", raw_time):
            return ClockClarification(leg=leg, event=field, direction=direction, clock=raw_time)
    if re.fullmatch(r"(?:something )?(?:earlier|later)(?: flights?)?", text):
        return f"{TIME_CLARIFICATION}? For example, “leave after 6 p.m.”"
    return None


def _named_window(period: str) -> LocalWindow:
    start, end = NAMED_WINDOWS[period]
    return LocalWindow(start=start, end=end)


def _bounded_window(bound: str, direction: str) -> LocalWindow:
    if direction == "after":
        return LocalWindow(start=bound, end="24:00")
    return LocalWindow(start="00:00", end="24:00" if bound == "00:00" else bound)


def _clock_bound(value: str) -> str | None:
    if value in {"noon", "midnight"}:
        return "12:00" if value == "noon" else "00:00"
    match = re.fullmatch(r"(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?m\.?", value)
    if match:
        hour, minute, meridiem = match.groups()
        if 1 <= int(hour) <= 12:
            return f"{int(hour) % 12 + (12 if meridiem == 'p' else 0):02d}:{minute or '00'}"
    if re.fullmatch(r"(?:0\d|1[3-9]|2[0-3]):[0-5]\d", value):
        return value
    return None


def departure_period(quote: dict) -> str | None:
    minute = local_minutes(quote.get("departure_time"))
    return tuple(PERIODS)[minute // 360] if minute is not None else None


def spread_departures(quotes: list[dict], *, leg: str = "outbound") -> list[dict]:
    """Keep the first (lowest-priced) quote in each available period near the top."""
    distinct, remaining, seen = [], [], set()
    for quote in quotes:
        period = departure_period(quote if leg == "outbound" else quote.get("return_flight") or {})
        if period is None or period in seen:
            remaining.append(quote)
        else:
            seen.add(period)
            distinct.append(quote)
    return distinct + remaining
