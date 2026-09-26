# Traveler and room constraints

## Nearby arrival airports

After a priced flight or trip result, choose **Compare nearby arrival airports**
or ask for cheaper flights to nearby airports. The requested destination remains
the reference point; the app searches up to six other scheduled-service airports
within 200 straight-line miles and in the same country. Only actual complete USD
flight quotes for your dates and traveler counts are compared. The requested
airport is searched again so airfare differences use current quotes.

If routing is available, results show approximate driving miles and time from
each alternative airport to the destination city. If routing is unavailable,
results show straight-line miles to the originally requested airport, explicitly
labeled as such. Neither measure is a promise about your exact hotel or final
ground route. Ground-transfer fare, rental car, tolls and other costs are not
priced, so a lower airfare does not establish a cheaper total journey. Confirm
route availability and all prices before booking. Airport candidates come from
the [OurAirports snapshot](../data/README.md), which can be incomplete or stale.

US7 adds `adults`, `children`, `children_ages` and `rooms` to the persisted trip.
A new trip defaults explicitly to one adult, no children, and one room. The
assistant preserves these values during destination/date corrections and displays
the selection alongside results and budget assessments. Removing children clears
their ages; an invalid extraction preserves the previous trip.

The app accepts up to nine travelers, with at least one adult aged 18 or older.
Children's ages are whole years at travel time, from 0 through 17. Missing or
inconsistent ages prompt clarification before any provider request. Counts and
ages are validated in the supervisor and again at the provider boundary.

Flight searches map ages 2–11 to child passengers and 12–17 to adult fares, while
retaining the original ages for hotel occupancy. The outbound and selected return
search both receive the same passenger counts. Infant flight seating is not yet
supported, so the assistant discloses that limitation and offers hotel-only search.
Hotel searches receive adults, children, and each child's age; ages below one are
sent as one, following the provider's documented convention.

The documented hotel API has no room-count parameter. Multiple requested rooms
remain saved, but hotel/full-trip search pauses with an explicit limitation and
offers one room or flights only. It never multiplies a single-room quote to invent
a multi-room total. Unsupported room counts do not block a flight-only search.

A2A messages carry a validated JSON party alongside the existing route/date fields.
Legacy requests without it use the explicit default. Returned quotes carry the
searched party, and the supervisor rejects results whose party metadata differs.
Provider-returned flight fares and full-stay hotel totals are used directly;
the app does not multiply them again by passenger or room count. Final occupancy,
availability and prices still need confirmation with the booking provider.

## Verification

- 109 backend tests pass, including 23 traveler regressions covering count/age
  validation, missing ages, unsupported combinations, A2A propagation, selected
  return requests, quote totals and wrong-party rejection.
- Coverage includes the new traveler module; the combined branch-inclusive
  coverage is 97.73%, above the existing 90% gate.
- Frontend lint, formatting, TypeScript and production build pass.
- The CI process-restart probe preserves adult/child counts, ages, room count and
  the route, then applies a destination correction after restart.
- All 14 browser tests pass across Chromium and Firefox. The family journey uses
  real API, SQLite, A2A/NATS and agent services.
  Only model/provider responses are fixtures. It verifies age/room clarification,
  reload, destination correction, isolation and price changes on traveler removal.
- The opt-in `scripts/conversation_smoke_test.py --party` passed with the configured
  model using a temporary conversation, without a priced provider search.

Provider references: [SerpAPI Flights](https://serpapi.com/google-flights-api),
[SerpAPI Hotels](https://serpapi.com/google-hotels-api),
[Google's passenger selector](https://www.google.com.sg/travel/explore),
[Google's multiple-passenger pricing](https://travel.googleblog.com/2013/01/now-you-can-use-flight-search-to-plan.html).
