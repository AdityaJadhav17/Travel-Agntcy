"""Create the small, deterministic airport snapshot used for comparison searches.

Download airports.csv from https://ourairports.com/data/ and run:
python scripts/update_airports.py .runtime/airports-source.csv
OurAirports data is public domain; this script never fetches data at runtime.
"""

import csv
from pathlib import Path
import re
import sys


OUTPUT = Path(__file__).resolve().parents[1] / "data" / "airports.csv"
FIELDS = ("iata_code", "name", "municipality", "iso_country", "iso_region",
          "type", "latitude_deg", "longitude_deg")
AIRPORT_TYPES = {"large_airport", "medium_airport", "small_airport"}


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/update_airports.py PATH_TO_OURAIRPORTS_CSV")
    source = Path(sys.argv[1])
    airports = {}
    with source.open(encoding="utf-8", newline="") as stream:
        for row in csv.DictReader(stream):
            code = row["iata_code"].upper()
            if (not re.fullmatch(r"[A-Z]{3}", code) or
                    row["scheduled_service"] != "yes" or
                    row["type"] not in AIRPORT_TYPES):
                continue
            try:
                latitude = float(row["latitude_deg"])
                longitude = float(row["longitude_deg"])
            except ValueError:
                continue
            if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
                continue
            # Keep the larger airport if source rows reuse an IATA code.
            rank = {"large_airport": 0, "medium_airport": 1, "small_airport": 2}[row["type"]]
            current = airports.get(code)
            if current is None or rank < current[0]:
                airports[code] = (rank, {field: row[field] for field in FIELDS})

    OUTPUT.parent.mkdir(exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(airports[code][1] for code in sorted(airports))
    print(f"Wrote {len(airports)} scheduled-service airports to {OUTPUT}")


if __name__ == "__main__":
    main()
