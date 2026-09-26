"""Bounded, offline discovery of arrival airports near a requested airport.

The reference point is the requested airport, not a city center. Distances are
straight-line miles and cannot be used as driving-distance estimates.
"""

import csv
from dataclasses import dataclass
from functools import lru_cache
from math import asin, cos, radians, sin, sqrt
from pathlib import Path


AIRPORTS_FILE = Path(__file__).resolve().parents[4] / "data" / "airports.csv"
MAX_RADIUS_MILES = 200
MAX_ALTERNATIVES = 6


@dataclass(frozen=True)
class Airport:
    code: str
    name: str
    municipality: str
    country: str
    region: str
    kind: str
    latitude: float
    longitude: float


@dataclass(frozen=True)
class NearbyAirport:
    airport: Airport
    straight_line_miles: int


@lru_cache(maxsize=1)
def airport_catalog() -> dict[str, Airport]:
    with AIRPORTS_FILE.open(encoding="utf-8", newline="") as stream:
        return {row["iata_code"]: Airport(
            code=row["iata_code"], name=row["name"], municipality=row["municipality"],
            country=row["iso_country"], region=row["iso_region"], kind=row["type"],
            latitude=float(row["latitude_deg"]), longitude=float(row["longitude_deg"]),
        ) for row in csv.DictReader(stream)}


def straight_line_miles(a: Airport, b: Airport) -> float:
    latitude_delta = radians(b.latitude - a.latitude)
    longitude_delta = radians(b.longitude - a.longitude)
    arc = sin(latitude_delta / 2) ** 2 + (
        cos(radians(a.latitude)) * cos(radians(b.latitude)) * sin(longitude_delta / 2) ** 2
    )
    return 3958.8 * 2 * asin(min(1, sqrt(arc)))


def nearby_arrivals(code: str, *, radius_miles: int = MAX_RADIUS_MILES,
                    limit: int = MAX_ALTERNATIVES) -> list[NearbyAirport] | None:
    """Return same-country candidates, balancing nearby and major airports.

    ``None`` means the requested code is missing from the snapshot; an empty
    list means it is known but has no eligible alternatives in the radius.
    """
    catalog = airport_catalog()
    target = catalog.get(code.upper())
    if target is None:
        return None
    eligible = sorted((
        (straight_line_miles(target, airport), airport)
        for airport in catalog.values()
        if airport.code != target.code and airport.country == target.country
    ), key=lambda item: (item[0], item[1].code))
    eligible = [(miles, airport) for miles, airport in eligible if miles <= radius_miles]
    selected = eligible[:3]
    selected_codes = {airport.code for _, airport in selected}
    added_large = 0
    for miles, airport in eligible:
        if airport.kind == "large_airport" and airport.code not in selected_codes and len(selected) < limit:
            selected.append((miles, airport))
            selected_codes.add(airport.code)
            added_large += 1
            if added_large >= 3:
                break
    for miles, airport in eligible:
        if len(selected) >= limit:
            break
        if airport.code not in selected_codes:
            selected.append((miles, airport))
            selected_codes.add(airport.code)
    return [NearbyAirport(airport, round(miles)) for miles, airport in
            sorted(selected, key=lambda item: (item[0], item[1].code))]
