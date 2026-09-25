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
the provider's default passenger/room selection. Removing the budget clears it.

US7–US9 and phases 3–4 remain planned. This slice does not enforce passenger or
room counts, provide token streaming, or support authenticated users.

Browser chat-switch verification also passed: a pending Tokyo reply completed
in its own chat while the New York result remained unchanged. Reopening Tokyo
asked for its origin, confirming that Dallas did not leak from the other chat.

The [CI pipeline](ci.md) now protects this work with unit/API regressions and
credential-free Chromium/Firefox journeys, including concurrent retries and a
real process restart. The inherited Python dependency vulnerability backlog is a
blocking check and must be remediated before the overall quality gate turns green.

Budget verification: 57 backend tests and 12 Chromium/Firefox E2E tests pass.
Combined branch-inclusive coverage of conversation storage/coordinating and
budget decisions is 98.68%. Frontend lint, formatting, types and build pass.
The budget work also fixes one-way trips showing a one-night label for a
multi-night hotel stay. The dependency audit blocker remains unchanged.

The configured live model also passed the four-turn budget smoke test: USD 500
survived the origin clarification, changed to USD 600 alongside a destination
correction, and cleared when requested. No priced provider search was needed.
