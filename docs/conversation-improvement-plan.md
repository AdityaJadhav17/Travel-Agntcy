# Travel conversation improvement plan

## Outcome

Let travelers build and revise a trip over several messages without repeating
themselves. Preserve the existing React UI, FastAPI supervisor, A2A agents, NATS,
and Docker workflow. Improvements should be observable and testable, rather than
depending on a more expensive model to compensate for missing application state.

## Personas

| Persona | Goal | Current friction |
|---|---|---|
| Maya, an occasional traveler | Plan a trip while still deciding dates | Must provide everything in a single prompt; clarification replies lose context |
| Alex, a budget-conscious traveler | Compare prices and revise one constraint | Budget is not represented in the search schema; repeated searches lose preferences |
| Priya, a family organizer | Coordinate passengers, rooms, and practical needs | Passenger/room counts and preferences are not enforced end to end |
| Jordan, a frequent traveler | Resume a saved trip and make quick changes | Sidebar history is local display data, not model memory |

## Delivery order and user stories

### Phase 1 — Conversation continuity (implement first)

- **US1, Maya:** As a traveler, I can answer a clarification with “Dallas” or
  “October 24–27” so I do not need to repeat my original destination.
  Acceptance: extraction sees the previous question, recent messages, and saved
  trip parameters; missing dates do not silently become a one-way booking.
- **US2, Jordan:** As a returning traveler, I can reopen a chat after a Docker
  restart and continue with the same trip. Acceptance: each chat has a stable
  UUID; backend messages and trip parameters live in a persistent Docker volume.
- **US3, Maya:** As a traveler, I can correct a destination/date without losing
  unchanged details. Acceptance: latest explicit corrections take precedence;
  ambiguous input triggers clarification; parameters survive clarification turns.
- **US4, Jordan:** As a traveler, separate chats stay separate and deleting one
  removes its backend memory. Acceptance: late responses cannot overwrite another
  chat; deletion persists locally and on the server, including during an in-flight turn.
- **US5, all:** As a traveler, a retried network request does not duplicate my
  saved turn. Acceptance: request IDs deduplicate completed requests; concurrent
  writes detect conflicts rather than silently overwriting another turn.

Phase 1 scope: conversation memory for existing origin/destination/date/search-type
fields, deterministic missing-field clarification, stable UI chat identities,
bounded context, persistence, isolation, deletion, and regression coverage.
Existing stateless clients remain compatible. It does not implement every story
below or change the configured model.

### Phase 2 — Constraints and grounded answers

- **US6, Alex:** “Under $1,500 total” applies to priced results, with an explicit
  currency and cost scope. Acceptance: budget survives follow-ups; code computes
  totals and labels excluded costs; no false “within budget” claims.
- **US7, Priya:** “Two adults and one child, two rooms” reaches every relevant
  provider. Acceptance: validate ages/counts, propagate through A2A and SerpAPI,
  and test quoted totals; unsupported preferences are disclosed.
- **US8, Jordan:** “Keep the flights, change the hotel” reuses selected results.
  Acceptance: stable result IDs and search timestamps; only invalidated searches
  rerun; stale prices are rechecked before presenting a refreshed quote.
- **US9, Alex:** “Why this one?” explains the previous recommendation without
  re-searching. Acceptance: answer cites retained result facts and separates
  actual availability/prices from general advice.

### Phase 3 — Responsive UI and structured results

- **US10, all:** See genuine progress, partial results, and incremental text.
  Acceptance: typed status/result/error/done events; no exposed internal reasoning;
  Stop cancels work where supported and late events are ignored.
- **US11, all:** Flight and hotel cards stay correct when response wording changes.
  Acceptance: a versioned validated response schema drives cards; Markdown remains
  for narrative and backwards compatibility.
- **US12, all:** A hotel timeout preserves successful flights and offers a focused
  retry. Acceptance: bounded provider timeouts, retry limits, explicit error versus
  empty-result states, and no duplicate displayed messages.

### Phase 4 — Multi-user readiness and evaluation

- **US13, all:** My saved travel conversations are private to my account.
  Acceptance: authenticated ownership checks on every conversation operation,
  expiry/deletion policy, rate limits, and a database suitable for multiple workers.
  Phase 1 is a local single-user app; UUIDs are opaque identifiers, not account auth.
- **US14, maintainers:** Changes improve a repeatable conversation evaluation set.
  Acceptance: cover corrections, missing/ambiguous dates, context isolation, long
  chats, restart recovery, retry conflicts, provider failures, and unsupported
  constraints. Track task completion, incorrect assumptions, latency, and tool cost.

### Phase 5 — Nearby arrival-airport comparison

- **US15, travelers:** When a requested flight is expensive, I can compare flights
  to other airports near my actual destination and see how far each airport is
  from that destination. Acceptance: search a bounded set of eligible arrival
  airports for the same dates and traveler party, verify each itinerary and USD
  fare, and show driving miles/time to the destination city when routing is
  available. Otherwise label straight-line miles to the requested airport.
  Never present a lower airfare as a lower whole-trip cost when ground transfer
  is unpriced, or replace the requested destination with an alternative airport.

## Implementation approach

Use a small SQLite conversation repository with atomic revision checks for the
first local slice (Python standard library; no extra service/dependency). Store
recent messages plus structured trip state; pass both into the existing graph.
Keep only bounded recent context and a bounded cache of completed request IDs.
An authenticated multi-user deployment and LangGraph checkpoint integration can
follow when durable graph-step resumption is required, rather than just turn memory.

Do not commit conversation databases or credentials. Persist the database under
`/data` in a named Docker volume and `.runtime` for native development.
Frontend chat history remains local for this slice; cross-device history sync is
deferred. Chats created before this feature need trip details restated once.

## Verification gate

Run credential-free tests in Docker for the store, API, graph context, missing
fields, corrections, idempotency, concurrent writes, failure rollback, and deletion.
Run frontend lint, formatting, typecheck and production build. Exercise an actual
multi-turn conversation in the browser and a backend restart with the same ID.
Document remaining limitations and update phase status only after verification.

## Delivery status

Phase 1 is implemented for the local Docker app. The configured model is unchanged.
The API preserves the existing stateless contract while the UI opts into durable
conversation IDs and request IDs. SQLite stores completed turns and trip details;
updates detect revision conflicts, and deletions leave an ID-only tombstone to
prevent late saves from restoring deleted content. The local API process now
serializes turns per conversation, so concurrent identical retries reuse the saved
response without repeating provider work. Other chats remain concurrent; queued
turns see updated context. Queue entries are cleaned up on completion, failure,
and cancellation. Cross-process in-flight deduplication remains future work.

Verification: 32 credential-free backend tests pass in Docker, including
overlapping retries, ordered follow-ups, and cancellation cleanup. Frontend lint,
formatting, typecheck and production build pass. A real-model three-turn smoke test
confirmed New York -> Dallas -> correction to Boston while preserving departure.
The browser completed “Plan a trip to New York” -> “Dallas” -> dates-only, with a
container rebuild/recreation between the second and third turns. It returned DFW/JFK
round-trip flights, a three-night hotel, and activities. Browser console was clean.

Phase 2 has started with US6: USD budgets for quoted flight fares and full hotel
stays persist across follow-ups, corrections and reloads. The app computes totals,
filters affordable flight/hotel lists and declines over-budget trip selections.
The response includes a structured budget assessment, also retained in browser
history. Unknown prices/currencies do not become affordable zero-cost results.
Ambiguous, non-USD, nightly, per-person and all-in budgets prompt clarification.
Activities, meals, transfers and unquoted fees are explicitly excluded; quotes use
the requested traveler selection in one hotel room (US7 below). Removing the budget clears it.

US7 is implemented for supported single-room searches, with explicit clarification
for multi-room requests and infant flight seating. Adults, children, ages at travel,
and requested rooms persist in conversation state. Provider adapters receive
validated counts, and quote metadata must match the requested party. US8–US12
and US14 are described below; multi-user US13 remains deferred. See
[traveler support](traveler-support.md) for boundaries.

US7 validation: 109 backend tests, 14 Chromium/Firefox journeys, the family
process-restart probe, and the configured live-model family smoke test pass.
Targeted branch-inclusive coverage is 97.73% after adding traveler validation.
Frontend checks and production agent builds also pass. The updated local Docker
app is running; this slice has not yet been committed or run in GitHub CI.

Browser chat-switch verification also passed: a pending Tokyo reply completed
in its own chat while the New York result remained unchanged. Reopening Tokyo
asked for its origin, confirming that Dallas did not leak from the other chat.

The [CI pipeline](ci.md) now protects this work with unit/API regressions and
credential-free Chromium/Firefox journeys, including concurrent retries and a
real process restart. The dependency audit now uses the maintainer-approved,
expiring NLTK exception documented in [remediation notes](dependency-remediation.md).

Budget verification: 57 backend tests and 12 Chromium/Firefox E2E tests pass.
Combined branch-inclusive coverage of conversation storage/coordinating and
budget decisions is 98.68%. Frontend lint, formatting, types and build pass.
The budget work also fixes one-way trips showing a one-night label for a
multi-night hotel stay. These budget-slice counts predate the traveler regressions.

The configured live model also passed the four-turn budget smoke test: USD 500
survived the origin clarification, changed to USD 600 alongside a destination
correction, and cleared when requested. No priced provider search was needed.

### Retained recommendations and explanations (US9, full-trip slice)

After a successful flight + hotel recommendation, the API stores a versioned,
bounded snapshot of the selected quote facts, stable quote IDs, UTC search time,
trip constraints and actual selection criteria. Facts are saved atomically with
the conversation and removed on deletion. Existing conversation databases gain
an additive table without changing or discarding their previous messages.

Travelers can ask “Why this one?” or “Why this trip?” to see the retained airline,
hotel, full-stay price calculation, budget result, timing criteria and any relaxed
rating thresholds. The answer is generated from facts in code; it does not rerun
extraction or provider searches. Other explanation phrasings use the existing
intent model before reaching the same deterministic answer. The response labels
prices as historical and does not imply refreshed availability.

New searches and clarification turns invalidate the prior selection, preventing
an old destination or party from being explained as a newly requested trip.
Greetings and repeated explanations retain it. Chats created before this feature
need one successful full-trip search to acquire a snapshot. Single-category search
lists do not yet retain selections for explanation.

US8 builds on these retained facts. Explanations never silently substitute a
new selection.

Docker verification: 124 backend tests pass, with 98.97% branch-inclusive coverage
across the gated modules, including 100% for recommendation facts/explanations.
All 16 Chromium/Firefox browser tests pass, as do Ruff, frontend lint, formatting,
typecheck, frontend build and the production supervisor build. Deterministic tests
cover model routing boundaries; these results do not measure live-model accuracy.
The real CI API process-restart probe also passed for both family trip state and
the exact retained recommendation. The local Docker app was recreated with the
updated supervisor and all services reported healthy. This US9 slice was
committed as `b9638207` before the US8 work below.

### Selective hotel replacement (US8)

“Keep the flights, change the hotel” retains the selected flight, destination,
dates, traveler counts, room count and budget. The supervisor requests fresh
hotel results through the existing A2A agent, excludes the previously selected
hotel and chooses the lowest eligible alternative. It checks check-in timing,
the full hotel stay price and the combined USD budget before saving a new
recommendation. Activity suggestions are not searched again, and the UI shows
the quote age and that activities were not refreshed.

The saved selection now includes a bounded flight itinerary and stable quote
IDs based on itinerary details or hotel identity rather than price. A selected
flight quote under five minutes old is reused for a hotel-only change. Older
flight quotes trigger a provider flight search to recheck the same itinerary.
If that itinerary is missing or has no complete USD quote, the app declines to
present a refreshed trip. It never silently substitutes a different flight.
The provider data does not guarantee a specific fare class or booking inventory;
search results remain quotes that can change before booking.

No eligible different hotel, provider failure, unsupported legacy snapshot,
or an over-budget replacement leaves the previous recommendation available
with a focused explanation. Conversations saved before the itinerary snapshot
was added need one new full-trip search before hotel replacement. Requests
that also change dates, party, destination, budget or specific hotel preferences
continue through normal trip extraction and search, rather than the simple swap.

Docker verification: 132 backend tests and 18 Chromium/Firefox journeys pass.
Branch-inclusive coverage across the gated modules is 98.78%; Ruff, frontend
lint, formatting, types, production build, and an actual API restart with a
hotel change all pass.

### Structured travel result cards (US11)

Successful conversation searches now return a versioned `travel_result` beside
the existing natural-language response. The payload contains bounded flight,
hotel and activity facts from the provider results after budget filtering, including full
hotel stay prices and unknown-price states. Full-trip hotel replacement returns
the retained flight and newly selected hotel. The browser validates version 1
before rendering cards and saves it with chat history. Unknown versions, malformed
data and older chats continue through the narrative renderer. The prose remains
available as travel notes. General and legacy Markdown is rendered without raw
HTML insertion.

The contract is covered by Python tests and browser journeys that rewrite the
response text while leaving quote data intact, reload the chat, and check the
unknown-version fallback. This establishes the result payload used by the
typed progress events below.

Docker verification: 136 Python tests pass with 99.05% branch-inclusive
coverage across the gated modules, including 100% for the result schema.
Ruff and frontend lint, formatting, TypeScript and production build pass.
All 22 Chromium/Firefox E2E journeys pass. The local Docker supervisor and UI
were recreated and reported healthy.

### Streamed progress and focused provider retry (US10, US12)

Conversation searches now use a typed NDJSON stream with public `status`,
`result`, `error`, `text`, and `done` events. Flight options appear while hotels
are still being searched. The browser shows the current search step and a Stop
button; cancellation aborts the request and ignores late events. The final
`done` event contains the same atomically saved, idempotent conversation result
as the non-streaming endpoint. The old endpoint remains available for clients
that need a single JSON response. Internal graph events and model reasoning are
not streamed.

Provider calls have 20-second supervisor timeouts. If a full-trip hotel call
fails or returns no options, the app keeps the successful flights and identifies
the failure separately from an empty result. Up to two focused hotel retries
reuse bounded saved flight facts; a flight quote older than five minutes is
rechecked against the same itinerary before the retry can present a trip. A
missing or unpriced itinerary never becomes a silently substituted flight.
Retry snapshots are stored with the conversation, cleared by a new search or
successful retry, and removed on deletion. The UI offers Retry hotels only when
the saved flights can support it.

Docker verification: 143 backend tests pass with 98.95% branch-inclusive
coverage across the gated modules; Ruff and frontend lint, formatting, types
and production build pass. All 26 Chromium/Firefox browser journeys pass,
including progress, Stop, transient hotel failure, retry after browser reload,
and previous conversation behavior.

### Scored conversation evaluation (US14)

The isolated CI stack now scores ten deterministic API/agent/provider journeys:
restart recovery, multi-turn correction, ambiguous dates, chat isolation, long
context, concurrent retry conflicts, transient provider failure, unsupported
constraints, grounded explanations, and nearby-airport comparisons. It checks explicit facts instead of
matching entire model prose, and fails CI if any scenario fails. The JSON artifact
records task completion, failed assumption checks, per-turn and p95 latency,
fixture extraction counts, and provider HTTP call counts. The last two are tool
cost proxies, not token usage or money. The model extractor is deterministic in
this suite; live-model language accuracy and real-provider behavior still need
separate measurement before claiming an improvement there.
The expanded Docker baseline passes 10/10 scenarios with zero failed fact
checks; median turn latency is 415 ms and p95 is 455 ms. The run recorded 39
fixture extractions and 43 provider HTTP calls. These values are a baseline for
this fixture and CI host, not production service-level targets.

### Nearby arrival airports (US15)

After a flight or full-trip result, the UI offers **Compare nearby arrival
airports**. A natural-language request for cheaper flights to nearby airports
uses the same path. The requested airport stays in conversation state while the
supervisor searches it again alongside up to six scheduled-service airports
within 200 straight-line miles in the same country. A versioned OurAirports
snapshot supplies candidates; only complete USD provider itineraries for the
same dates and travelers appear in results. Round-trip comparisons require a
return itinerary to the original origin. Flight searches run with a concurrency
limit of three and a 20-second per-search timeout.

The cards show the current requested-airport fare, alternative fares, and
verified airfare differences. SerpAPI directions supply driving miles and time
to the destination city when available. Otherwise the cards explicitly show
straight-line miles to the requested airport. Ground-transfer prices are not
available, so the list is ordered by airfare and does not claim a cheaper total
journey. The comparison remains in chat history after reload. The airport
snapshot is public-domain data with no guarantee of accuracy; flight and route
quotes can change before booking.

Docker verification: 148 backend tests pass with 97.72% gated branch-inclusive
coverage; frontend quality/build checks and all 28 Chromium/Firefox journeys
pass. The ten-case scored evaluation passes across an API restart.

### Conversational follow-ups and model fallbacks

General turns now receive a brief response grounded in recent messages and the
saved trip instead of repeating the same welcome script. The model is instructed
not to invent prices, availability, or bookings, and to ask at most one question.
If that response is unavailable, the app gives a short deterministic reply.
Intent classification has a bounded timeout and a conservative fallback: saved-trip
follow-ups and explicit travel requests continue to extraction; greetings and
thanks do not trigger a search. If extraction fails, the app retains the saved
trip and asks for the next missing detail, or asks the traveler to rephrase a
change when the trip is already complete. These fallbacks avoid a dead-end or a
repeated request for every trip field; they do not replace normal model parsing.
