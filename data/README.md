# Airport snapshot

`airports.csv` is a filtered snapshot of [OurAirports open data](https://ourairports.com/data/),
downloaded 2026-09-25. OurAirports releases the data to the public domain and
does not guarantee its accuracy. Only airports with a three-letter IATA code,
coordinates, and scheduled service are retained. The app uses the snapshot to
discover candidates; the flight provider must still return a priced itinerary.

To refresh, download the official `airports.csv` and run
`python scripts/update_airports.py PATH_TO_CSV`. Compare the diff before shipping.
Coordinates are airport locations. Miles calculated from them are straight-line
airport-to-airport estimates, not road distances or city-center distances.
