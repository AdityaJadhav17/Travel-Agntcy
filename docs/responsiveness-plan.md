# Travel responsiveness: measured implementation plan

Date: 2026-11-13. Start with cross-service timing correlation, then ship each
behavioral optimization as a separately tested change.

## Evidence and objective

One user-observed flight search completed in 12.80 seconds, with a first useful
card at 12.61 seconds and the final response rendered at 12.81 seconds. Its
supervisor recorded 1.58 seconds classification, 2.88 seconds extraction and
8.10 seconds flight-agent time. Matching provider timestamps showed 1.17 seconds
outbound lookup and three concurrent return lookups of 1.67, 2.58 and 6.93 seconds.
Those provider records lacked correlation IDs, so the association was inferred
from timestamps. These are one-run observations, not a median or a promise.

Target earlier useful information without reducing candidate coverage, changing
verified quote semantics, increasing provider calls or weakening access controls.
The illustrative first-information opportunity is about 5.6 seconds for this run
(model work plus outbound lookup). Full completion will still wait for required
return data. Do not describe provisional information as a completed itinerary.

## 1. Correlate timing across services — implement first

- Add an opaque timing ID to A2A message metadata from the supervisor.
- Flight, hotel and activity executors validate the ID, enter a request-local
  context and reset it on success, failure and cancellation. Missing or invalid
  IDs generate fresh IDs rather than becoming arbitrary log content.
- Never add prompt text, credentials, departure tokens or provider URLs to timing
  fields. Do not send tracing metadata to the external search provider.
- Prove concurrent requests stay isolated and that real NATS requests preserve
  metadata. The same ID should join browser, supervisor and provider stages.

Acceptance: targeted propagation/context tests, complete Docker backend suite,
and a real fixture-stack search where the same ID appears in supervisor and
flight-provider timing logs. No paid searches needed. This phase improves
measurement, not speed.

## 2. Stream provisional outbound results — next behavior change

First validate the installed A2A/NATS client's incremental event support. A
single-response client cannot deliver provisional messages just by emitting more
events; preserve the existing final-response contract until a supported stream
path is proven end to end.

Design review: the flight card advertises `streaming=False`; its executor awaits
one `ainvoke` and the supervisor calls `send_message`. The existing browser
NDJSON partial-result path is usable, but it does not make the internal NATS
request/reply path incremental. Verify against the Docker-locked SDK, not merely
an installed host SDK. Existing flight cards already arrive before hotel work
on full-trip requests; the missing step is progress *within* the flight search.

- Emit a sanitized outbound snapshot after the existing outbound request and
  before return enrichment. Never repeat the search to obtain early data.
- Introduce an explicitly provisional event/card contract with stable itinerary
  IDs. Show airline, times and stops; omit unverified round-trip prices and totals.
  Label return details as pending and disable selection of incomplete options.
- Keep all three existing return lookups, concurrency caps and final ranking.
  Publish verified final results using the current final-result contract.
- Keep previews transient: no completed-request replay, persisted recommendation,
  budget decision, hotel choice or cheapest-trip calculation may consume them.
- On stop, timeout or failure, remove/expire previews or clearly mark the search
  unsuccessful. Never promote a preview to success. Reject late or cross-chat
  events using existing request ownership. A completed replay must not restart
  provider calls.
- Preserve one-way behavior. Gate the feature off by default until its fixture
  tests pass; expose it locally only after review.

Acceptance: delayed-provider fixture proves preview before slow return finishes;
same outbound/return call counts; exact final results match the baseline; no
departure token in events; failure/cancellation/reload/replay tests; malformed
preview fallback; Chromium/Firefox rendering and timing tests. Record provisional
first-information timing separately from first verified result timing so the
new UX cannot disguise unchanged final latency.

### Transport validation — 2026-11-17

The locked AGNTCY NATS bridge accumulates ASGI body chunks before sending a
single response. Its transport streaming helpers alone cannot flush flight
progress. A Docker test using the locked native A2A HTTP server received a
fixture progress event while the executor was deliberately blocked, then
received its final response after release.

Use this native HTTP stream as the candidate for a single opt-in flight request
within the private service network. Keep the usual NATS path for deployments
without flight HTTP streaming enabled. Choose the path before dispatch so an
interrupted HTTP stream cannot trigger a second provider search via NATS. Test
disconnect handling with a blocked provider fixture before enabling the path.
The flight card still advertises its current production capability.

Phase 1 passed Ruff and the complete 253-test Docker suite at 92.77% configured
coverage. A real NATS fixture trip carried one response timing ID through the
supervisor and flight, hotel and activity provider logs. The fixture streaming
test covers SDK transport behavior. Connecting it to flight data and the browser
remains phase 2 work.

### Outbound preview implementation — 2026-11-17

The opt-in implementation uses a small internal NDJSON route on the flight
agent's existing HTTP server. It owns the flight task and cancels and awaits it
when the supervisor disconnects. This provides an explicit cancellation path
while the SDK's native A2A streaming handler owns its producer independently.
The route is mounted only with the preview flag enabled and identity auth
disabled, on the existing private Docker network. It is absent in the default
configuration. Keep the flight service off host port bindings.

The supervisor chooses the path before dispatching a primary round-trip search.
The same provider search emits a snapshot of up to three outbound candidates
while return searches run. The snapshot contains only airline, departure time,
arrival time and stops. It is scoped to the pending chat and disappears on a
verified result, failure or Stop. Final pricing and selection use the existing
completed search output. An interrupted stream does not trigger another search.

For opt-in persistence in local Docker, set `TRAVEL_FLIGHT_PREVIEW_ENABLED=true`
in `.env`, then run `docker compose up -d --build ui` and `docker compose restart ui`.
Set the flag to `false` and recreate the services to roll back the preview path.
`window.__travelLatency.print()` reports `firstOutboundPreviewMs` separately
from `firstUsefulCardMs` and final render time.

The isolated fixture check at `scripts/ci/check_flight_preview.py` holds the
return provider response until it sees the preview. The normal and preview
paths each made two provider calls and returned identical final flight cards
and prices. This demonstrates earlier delivery under a controlled delay.
Final validation passed 256 backend tests at 92.77% configured coverage,
146 Chromium and Firefox tests, frontend checks, Ruff and the local access
probe. The local Docker launch enabled the flag for its current containers.
The validation used fixtures and invalid inputs, and spent no API credits.

## 3. Reduce model round trips — controlled experiment

- Combine intent and parameter extraction for eligible new searches using a
  structured, validated schema. Preserve deterministic follow-ups and current
  saved-state, date, party, accommodation and budget checks.
- Keep an explicit fallback to the existing route for uncertain/invalid output.
  Count fallback model calls so savings are not inferred from a nominal call count.
- Keep the same model. Compare correctness before changing the default.

Acceptance: existing conversation evaluations plus ambiguous requests, corrections,
unsupported constraints and malicious/untrusted content fixtures; no regression
in tool dispatch or saved preferences. A bounded live comparison requires an
agreed request budget. Removing the measured 1.58-second classification step is
an illustrative opportunity only: a larger combined call may take longer.

Set `TRAVEL_COMBINED_DECISION_ENABLED=true` to opt in. The supervisor tries the
combined call on first turns that mention travel and have no saved trip or
recommendation, when the two model roles resolve to the same model. It
falls back to separate calls on uncertainty, invalid output, error, or timeout.
Compare the request-correlated `combined_travel_decision` duration and fallback
logs with `intent_classification` and `parameter_extraction`. Use browser times
to compare the outbound preview, first verified card, and final render.

A single live GPT-6 Luna comparison used the same DFW–JFK round trip (February
12–15, 2027) with the baseline first. Both paths returned five verified flight
options for the same trip.

| HTTP stream milestone | Separate calls | Combined call |
| --- | ---: | ---: |
| Model stages | 7.62 s | 2.91 s |
| Outbound preview received | 10.03 s | 2.97 s |
| First verified result received | 15.78 s | 3.06 s |
| Terminal event received | 15.98 s | 3.26 s |

The second provider lookup was also faster. Outbound plus the longest parallel
return lookup fell from 7.52 s to 0.12 s. Cache status was unverified. The
model-stage difference was 4.71 s for this pair. These timings exclude browser
rendering. Keep the flag opt-in pending broader live comparisons.

## 4. Overlap flights and hotels where safe

- Run independently only when required location and stay dates are explicit and
  validated. Otherwise keep the existing dependency order.
- Keep arrival/check-in compatibility checks after both results arrive. Preserve
  usable partial results and targeted retries in both failure directions.
- Measure additional hotel calls on failed-flight attempts before enabling by
  default. Concurrency can change cost even if successful-path counts stay equal.

Acceptance: flight/hotel reverse failures, cancellation, empty/incompatible stays,
budget and party constraints, activity opt-out, persistence and browser tests.
Do not use the flight-only sample to claim a combined-trip speedup.

## Return lookup investigation

In the four-search browser comparison, each first search had three overlapping
return lookups. The earliest return arrived 6.68 s before the slowest on
DFW–LGA and 7.48 s before the slowest on SFO–SAN. On repeat searches the
slowest lookups took about 0.08 s. SerpAPI documents an exact-query cache, which
is consistent with the difference, but the samples did not identify cache
hits. SerpAPI uses a separate departure-token request for each outbound
itinerary whose return options must be retrieved.
[SerpAPI Google Flights documentation](https://serpapi.com/google-flights-api)

The flight agent records `return_lookup_headers` (send through response
headers) and `return_lookup_body` (read and decompress the body) under
`provider_http`. Compare these to the parent `return_lookup` span by request ID.
The header span includes connection setup and provider wait. Continue to count
only the parent span as a provider lookup. The records contain durations,
outcomes and opaque request IDs.

Run the credential-free scaled-delay fixture with
`python scripts/benchmark_travel_latency.py --samples 12 --return-delays-ms 185 428 934 --caps 1 2 3 6`
inside the CI Python image. `first_return_ready_ms` is the first fixture
provider response, measured before rendering. The final result still waits for
all three token lookups. Across 12 samples per cap, median enrichment was
1,550 ms at cap 1, 1,121 ms at cap 2, and 936 ms at both cap 3 and cap 6. The
first return was ready in about 186 ms. Every search made four provider calls
and returned all three token-matched round-trip quotes.

The opt-in first checked round-trip card uses the existing private flight
stream. Enable both `TRAVEL_FLIGHT_PREVIEW_ENABLED` and
`TRAVEL_VERIFIED_FLIGHT_PREVIEW_ENABLED` for standalone round trips without a
budget filter. The card shows the first matching priced return while other
fares are checked. It expires when a final card or error arrives, or when
the search is stopped. Final ranking, recommendations, hotel compatibility
and saved results use the completed quote set. Compare `firstUsefulCardMs`
separately from final render time.

## Release and measurement gates

Each phase gets an independent diff and rollback. Keep limits, authentication,
provider coverage and existing quote validation enabled. Use fixtures for automated
checks; never run unbounded live benchmarks. For live comparisons use matched
requests and configuration, report sample counts/median/range and failures, and
separate first provisional information, first verified card and final completion.
Avoid claiming a maximum across all searches from one sample.
