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


class FlightTiming(BaseModel):
    outbound_departure: LocalWindow | None = None
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
        return all(
            not (window := getattr(self, f"{leg}_{event}")) or window.matches(quote.get(f"{event}_time"))
            for event in ("departure", "arrival")
        )

    def window_summary(self) -> str:
        labels = []
        for leg in ("outbound", "return"):
            for event in ("departure", "arrival"):
                if window := getattr(self, f"{leg}_{event}"):
                    label = f"{leg} {event} {window.start}–{window.end}"
                    if window.start > window.end:
                        label += " (across midnight)"
                    labels.append(label)
        return ", ".join(labels)


def timing_from_message(message: str) -> FlightTiming | None:
    match = re.search(r"(?:^|\s)timing:", message)
    if match:
        payload = message[match.end():].partition(" party:")[0]
        return FlightTiming.model_validate_json(payload)
    return None


def simple_timing_edit(text: str, current: FlightTiming) -> FlightTiming | str | None:
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
    if current.compare_departures == leg and f"{leg}_departure" in changes and "compare_departures" not in changes:
        changes.update(compare_departures=None, comparison_periods=[])
    return current.model_copy(update=changes)


def _timing_edit(text: str, leg: str) -> dict | str | None:
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
        start, end = NAMED_WINDOWS[text]
        return {f"{leg}_departure": LocalWindow(start=start, end=end)}
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
        if (bound := _clock_bound(raw_time)) is not None:
            if bound == "00:00" and direction == "before":
                bound = "24:00"
            start, end = (bound, "24:00") if direction == "after" else ("00:00", bound)
            field = "arrival" if event in {"arrive", "land"} else "departure"
            return {f"{leg}_{field}": LocalWindow(start=start, end=end)}
        if re.fullmatch(r"(?:[1-9]|1[0-2])(?::[0-5]\d)?", raw_time):
            return f"{TIME_CLARIFICATION}, {raw_time} a.m. or {raw_time} p.m.?"
    if re.fullmatch(r"(?:something )?(?:earlier|later)(?: flights?)?", text):
        return f"{TIME_CLARIFICATION}? For example, “leave after 6 p.m.”"
    return None


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
