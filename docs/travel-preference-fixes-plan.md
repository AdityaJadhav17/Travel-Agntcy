# Travel preference fixes: implementation and validation plan

Status: implemented and reviewed; fixture and bounded live validation completed.
Date: 2026-11-10. Model remains GPT-6 Luna with low reasoning effort.

## Goal and evidence

Honor explicit travel preferences consistently across provider calls, streamed
cards, final text, saved conversations, and retries. Do not add paid calls merely
to format or validate results.

Two live smoke tests exposed these failures:
- “Three things to do” returned five cards and ten text suggestions.
- “Flights and hotels only, no activities” still fetched and included activities.
- A request for one hotel room selected a hostel without evidence of room privacy.
- A December 10 hotel booking was paired with a December 11 00:30 flight arrival,
  without explaining that late arrival/reservation retention needed confirmation.

The last two are unverified suitability claims, not proof that the lodging or
arrival is impossible. Preserve useful quotes while making uncertainty explicit.

## 1. Enforce search scope before calling providers

Evidence: `TravelSearchArgs.search_type` has only four values. The combined
`_complete_full_trip` path in `graph.py` unconditionally calls the activity agent.
The keyword override also matches category words without understanding negation.

Implementation:
- Keep existing search types and result kinds for compatibility. Add an optional
  persisted `include_activities` preference for combined trips; missing values
  retain legacy full-trip behavior. A full-trip result already requires only
  flights and hotels, so a new result kind is unnecessary for this fix.
- Extract explicit inclusions/exclusions and preserve them through clarification
  replies. Normalize explicit “no activities” / “flights and hotels only” before
  dispatch. Do not let positive keyword matching override an explicit exclusion.
- Gate the activity call, progress events, cards, and text on the same effective
  preference, including hotel retry and completion paths.
- Handle an explicit later “add activities” as a preference change. For category
  combinations not supported by existing handlers, clarify instead of silently
  searching an unrequested category. Avoid building a general dispatcher here.

Acceptance: flight+hotel-only calls those two providers and never the activity
provider; ordinary full trips retain their current behavior. The preference
survives reload, “same dates,” hotel retry, and replacement-hotel turns.

Tests: async provider spies for inclusion/exclusion, negation and ambiguous input;
conversation persistence and retry tests; stream assertions for absent activity
events and absent activity content. Use existing conversation, partial-search,
hotel-replacement, and travel-result test modules.

## 2. Represent accommodation requirements and evidence separately

Evidence: `TravelParty.rooms` is an occupancy count. It does not prove private-room
availability. `serpapi_tools._parse_hotel` drops property/room classification, and
`HotelCard` currently contains only name, prices, and ratings.

Implementation:
- Add persisted lodging preferences: allowed accommodation category and explicit
  private-room requirement. Do not convert a numeric room count into verified
  privacy. “Hotels only” excludes known hostels; broad “accommodation” stays broad.
- Retain provider-supported property/room evidence and its source in normalized
  quotes. Inspect existing sanitized fixtures and provider schema before mapping
  fields: do not invent a provider parameter or treat a generic “hotel” field as
  proof of a private room. Missing evidence stays unknown.
- Apply one eligibility function before recommendation selection and before
  emitting hotel cards. Reuse it for hotel-only, combined, retry, and replacement
  searches. Preserve the existing occupancy and budget checks.
- Explicit requirements use matched / contradicted / unknown outcomes. Exclude
  contradicted quotes; unknown quotes may be shown with a clear unverified label,
  but cannot become a recommendation claimed to satisfy that requirement. If
  none are confirmed, explain the limitation and ask whether to relax it.
- Keep quote-derived unknowns distinct from model guesses. A name containing
  “hostel” can be a conservative exclusion signal, never positive proof of room
  type. Do not silently substitute shared accommodation.
- Add optional evidence/status fields to backend and frontend card contracts;
  older saved cards load with unknown status. Preserve bounded strings and lists.

Acceptance: explicit hotel/private-room requests never receive an unlabeled
hostel or an unsupported privacy claim. Users can explicitly allow hostels.
Unknown provider metadata does not discard all useful search results silently.

Tests: known hotel, known hostel, private/shared room evidence, absent/conflicting
metadata, old cards, preserved occupancy, no eligible options, and follow-up
preference changes. Verify both text and card labels and recommendation selection.

## 3. Use one bounded presentation selection for counts

Evidence: `_format_activities_only` slices ten results while `travel_result`
slices five. Hotel text also slices ten; flight text and cards slice five.

Implementation:
- Add optional validated per-category result counts, preserved across follow-ups.
  Use a shared presentation-selection helper after eligibility/ranking and before
  both text rendering and card serialization.
- Keep the existing five-card contract for this iteration. Requests from one to
  five return at most that count. Requests above five get an explicit “showing up
  to five” notice; invalid/ambiguous counts ask for clarification. Do not silently
  promise ten while returning five. Missing counts default to five consistently.
- If fewer eligible results exist, show the actual number and explain the
  shortfall. Do not manufacture or duplicate options to reach the requested count.
- Keep raw candidate pools available for ranking and cheapest-plan selection;
  presentation limits must not truncate optimization inputs. Combined-trip output
  remains one selected pair, with optional activity suggestions; comparison
  result lists keep their existing separate limits.

Acceptance: “three activities” shows the same three ordered entries in cards and
text; no additional provider call is needed to enforce a display count.

Tests: one/three/five, over-limit, invalid count, fewer results, duplicates,
default behavior, stable ordering, and cheapest candidate outside the displayed
subset. Include frontend contract and rendering checks.

## 4. Make hotel dates and arrival compatibility explicit

Evidence: hotel search currently uses flight departure `start_date` as check-in.
The hotel parser substitutes 15:00 for unknown check-in time. `travel_logic`
assumes a hotel holds a reservation when arrival is after the check-in date;
that does not establish late-check-in availability.

Implementation:
- Add separate optional hotel check-in/check-out dates to trip state. Explicit
  hotel dates take precedence and must survive extraction, retry, replacement,
  quote identity, budget/nights calculation, cards, and final text. Preserve old
  state loading with documented legacy date defaults.
- Introduce a pure timing assessment with compatible / incompatible /
  needs-confirmation outcomes and reason codes. Treat check-in opening time,
  closing time, early arrival, and reservation retention as distinct facts.
- Stop presenting default or malformed check-in times as provider-confirmed.
  Retain unknown-time provenance. An airport-to-hotel buffer is a configured
  estimate, not a verified transfer duration.
- Evaluate destination-local arrival date/time plus the buffer against actual
  stay dates. Normalize supported time formats; missing zone/time evidence must
  produce uncertainty rather than an invented timezone conversion.
- A next-day arrival against a prior-day booking requires late-arrival/retention
  confirmation unless provider evidence resolves it. Early arrival may require
  waiting until check-in, not automatic rejection. Arrival at/after checkout
  cannot be represented as a usable stay.
- Never silently move an explicit hotel date. If dates are implicit and an
  overnight flight makes them ambiguous, request the user's intended stay dates
  before another hotel search. Do not search hotels separately for every flight.
- Prefer compatible quotes; surface uncertain combinations as provisional with
  their quoted total, never as a fully validated recommendation. If no compatible
  pairing exists, preserve useful separate flight/hotel results and explain why.
- Use the same assessment in graph selection and the legacy
  `find_best_travel_plan` tool to avoid two incompatible timing policies.

Acceptance: the observed 00:30 arrival plus two-hour buffer explicitly states
that a prior-night booking and late arrival need confirmation. Nights and totals
use the dates actually sent to the hotel provider. No unsupported guarantee is
made that the hotel will hold the reservation.

Tests: ordinary same-day arrival; before check-in with waiting; buffer crossing
midnight; prior-night booking; overnight/date-line flights; missing/invalid or
Unicode-spaced times; known closing time; arrival at checkout; explicit hotel
dates; old saved trips; repricing after dates change; retry and replacement.

## Delivery and verification order

1. Add additive preference/evidence contracts and pure policy helpers with tests.
2. Implement scope and result counts first, preserving existing result kinds.
3. Implement accommodation eligibility and timing assessment, then wire every
   recommendation, partial-result, retry, and replacement path.
4. Update frontend validation, cards, text and saved-state compatibility together.
   Document the new state transitions and stream fields in existing contract docs.
5. Run focused Python tests plus frontend type/lint/contract checks. Then run the
   existing Docker CI suite, browser regressions, persistence checks, and coverage
   gate using fixtures. A passing fixture suite is not proof of live Luna quality.
6. After fixture checks pass, perform a bounded live evaluation: one three-activity
   request, one flight+hotel-only request with explicit lodging/stay preferences,
   and one clarification/follow-up when needed. Record provider call counts,
   returned categories, displayed counts, uncertainty labels, latency, and usage
   when available. Stop on failure; do not run an unbounded paid evaluation loop.

No booking, model change, credit purchase, or billing setting change is included.

## Plan validation completed

Read the extraction schema and prompt, dispatch/completion and formatting paths,
provider hotel parser, shared timing/selection logic, retained-search schema,
backend card schema, frontend result types, and existing test inventory.

Review corrections incorporated before confirming this plan:
- Reuse `full_trip` for flight+hotel results instead of breaking result-kind enums.
- Preserve the five-card bound instead of promising arbitrary counts.
- Distinguish room count from evidence of a private room.
- Preserve explicit hotel dates; do not “fix” overnight arrivals by silently
  shifting a booking or assuming the hotel holds it.
- Include retry, replacement, quote identity, budgets, and old saved state in
  acceptance checks, not only the initial happy-path request.

Remaining implementation-time validation: provider metadata availability and
Luna extraction accuracy. Unknown metadata has an explicit safe outcome in this
plan, so neither is a reason to fabricate evidence or guarantee behavior now.

Provider schema review during implementation: the [SerpAPI Google Hotels
documentation](https://serpapi.com/google-hotels-api) supplies property `type`,
`check_in_time`, and `check_out_time`. Checkout time is not a check-in deadline.
The documented search schema does not establish room privacy or late-arrival
reservation retention; these remain unknown rather than inferred guarantees.

Implementation uses shared presentation selection, persisted scope and lodging
preferences, explicit stay dates, and evidence-based lodging assessments. Luna
agents implemented and reviewed the changes; the orchestrator reviews integration
and runs the Docker validation. Final verification results are recorded below.

## Verification record (2026-11-11 local time)

- Docker backend: 194 tests passed; 94.44% branch-inclusive coverage on the
  configured coverage set (not whole-project coverage). Python lint passed.
- Docker frontend: lint, formatting, both TypeScript configurations and production
  build passed. The existing large JavaScript bundle warning remains.
- Chromium and Firefox: all 124 browser/contract cases passed. After the final
  presentation corrections, four targeted evidence/legacy-card cases passed
  again across both browsers; backend, lint and frontend checks also passed again.
- API restart: saved-party corrections, recommendation identity, replacement and
  hotel retry passed. All 10 fixture conversation evaluation scenarios passed.
- Two live streaming requests used `openai/gpt-6-luna`, reasoning `low`:
  - Three New York activities: exactly three cards and matching numbered prose;
    only the activity category emitted search/result events.
  - SFO–JFK December 10–13, flights and hotels only: both categories returned,
    no activity events, and explicit December 10–13 hotel dates remained intact.
    The selected same-day flight/hotel pairing explicitly said room privacy was
    unverified and the recommendation provisional. No known-hostel result was
    presented as meeting a hotel requirement.
- Live provider call counts, token usage, charges and end-to-end latency were not
  instrumented in the smoke output; stream events are not exact provider counts.
  No booking or billing changes were made. Overnight retention and checkout-time
  boundaries were verified with deterministic fixtures; the live selected flight
  arrived the same day.
- Live review prompted two final presentation corrections: readable evidence
  labels with intact machine codes, and quoted stay totals shown without claiming
  that a rounded nightly rate multiplies exactly to the provider total. These
  corrections passed fixture validation; no additional paid requests were made.

Local test artifacts are under `.runtime/ci/`, including `pytest.xml`,
`coverage.xml`, `conversation-eval.json`, `live-three-activities.ndjson`, and
`live-flight-hotel.ndjson`.
