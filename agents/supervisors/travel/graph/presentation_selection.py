"""Shared bounded selection for travel text and card presentations."""

from collections.abc import Sequence
import re


def _identity(item):
    if isinstance(item, dict):
        for key in ("id", "name", "hotel_name", "title"):
            value = item.get(key)
            if value:
                return key, str(value).strip().casefold()
        return None
    for key in ("id", "name", "hotel_name", "title"):
        value = getattr(item, key, None)
        if value:
            return key, str(value).strip().casefold()
    return None


def select_for_presentation(items: Sequence, requested_count: int | None = None, *, limit: int = 5):
    """Select the same bounded prefix for text and cards; return it and a notice."""
    requested = requested_count if requested_count is not None else limit
    unique = []
    seen = set()
    for item in items:
        identity = _identity(item)
        if identity is not None and identity in seen:
            continue
        if identity is not None:
            seen.add(identity)
        unique.append(item)
    selected = unique[: min(requested, limit)]
    notices = []
    if requested > limit:
        notices.append(f"Showing up to {limit} options per request.")
    if len(unique) < min(requested, limit):
        notices.append(f"Only {len(selected)} eligible option{'s' if len(selected) != 1 else ''} were found.")
    return selected, " ".join(notices)


_NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
}


def explicit_requested_count(text: str, category: str) -> tuple[int | None, bool]:
    """Extract only explicit option counts tied to a category, avoiding party/stay counts."""
    category_words = {
        "activity": r"(?:activities|activity|things\s+to\s+do|attractions)",
        "hotel": r"(?:hotels?|hotel\s+options?|accommodations?)",
        "flight": r"(?:flights?|flight\s+options?|fares?)",
    }[category]
    number = r"(one|two|three|four|five|six|seven|eight|nine|ten|\d+)"
    malformed = re.search(
        rf"(?<!\w)[+-]\s*\d+(?:\.\d+)?\s+{category_words}\b|"
        rf"(?<!\w)\d+\.\d+\s+{category_words}\b",
        text.lower(),
    )
    if malformed:
        return None, True
    patterns = (
        rf"\b(?:show|give|find|list|return|display|up\s+to)\s+(?:(?:me|us)\s+)?{number}\s+{category_words}\b(?!\s+(?:rooms?|nights?|stays?|travelers?|people|adults?|children))",
        rf"\b{number}\s+{category_words}\b(?!\s+(?:rooms?|nights?|stays?|travelers?|people|adults?|children))",
        rf"\b{number}\s+{category_words}\s+(?:options?|results?)\b",
        rf"\b{category_words}\s+(?:options?|results?)\s*[:=]?\s*{number}\b",
    )
    matches = []
    normalized = text.lower()
    for pattern in patterns:
        matches.extend(re.findall(pattern, normalized))
    if not matches:
        vague_count = re.search(
            rf"\b(?:show|give|find|list|return|display)\s+(?:a\s+)?(?:few|several|many|couple\s+of)\s+{category_words}\b",
            normalized)
        if vague_count:
            return None, True
        return None, False
    values = []
    for raw in matches:
        try:
            values.append(_NUMBER_WORDS.get(raw, int(raw) if raw.isdigit() else None))
        except ValueError:
            pass
    values = [value for value in values if value is not None]
    if not values or len(set(values)) != 1 or values[0] < 1 or values[0] > 100:
        return None, True
    return values[0], False
