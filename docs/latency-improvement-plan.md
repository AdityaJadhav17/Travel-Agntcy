# Travel app latency improvement plan

Status: implementation started on 2026-11-12 after adding local-owner security.
Initial stage timing and bounded return-flight concurrency are implemented.
Connection pooling is also implemented and validated (see Phase 3 execution
record below). Flight/hotel overlap and combined model decisions remain planned.
No paid requests were made for this implementation's validation.

Browser end-to-end diagnostics were added on 2026-11-13. See
[Measuring latency](measuring-latency.md) for collection instructions, metric
definitions, server correlation and limitations. Rendering timings approximate
paint opportunities; terminal receipt is distinct from network completion.

## Objective

Reduce time to the first useful travel result and time to a completed response,
while preserving search coverage, quote correctness, preferences, saved-state
behavior, and bounded API usage. Keep the current Luna model configuration for
the initial optimization work so model changes do not confound comparisons.

## Baseline and evidence

| Evidence | Observed result | Limitation |
| --- | --- | --- |
| Existing deterministic conversation evaluation | Median 432.7 ms; p95 521.8 ms | Fixture model/providers, mixed scenarios; not live latency |
| Last live flight/hotel stream | Hotel result timestamp was about 2.9 seconds after flight result timestamp | One interval from one request; excludes earlier model and flight work |
| Live request to first useful result / completion | Not measured | No defensible live median, p95, or percentage improvement yet |

Code evidence:

- `graph.py` normally makes an intent classification call before parameter
  extraction. Known follow-ups already have deterministic routes.
- `serpapi_tools.py:search_flights` first searches outbound flights, then awaits
  up to three token-specific return searches one at a time.
- `_request_search` constructs and closes an `httpx.AsyncClient` per request.
- `_handle_full_trip_search` waits for flights before starting hotels;
  `_complete_full_trip` subsequently fetches activities when requested.
- Progress/cards already stream. Final prose is formatted and chunked after the
  completed response; this is not token-by-token model generation.
- The stream queue's 0.2-second timeout is a polling timeout, not a mandatory
  200-ms delay for every event. Do not claim removing it saves 200 ms per card.
- Provider processes serve HTTP and NATS together. An HTTP-only lifespan hook
  cannot be assumed to cover every provider request.
- The graph currently bounds many provider calls at 20 seconds, while the HTTP
  helper allows 60 seconds. Verify whether A2A cancellation reaches remote work;
  coordinate deadline handling rather than merely lowering either number.

## Invariants for every phase

1. Preserve selected outbound/return association, USD/party pricing, hotel dates,
   lodging evidence, activity opt-out, counts, and the full optimization pool.
2. Preserve request idempotency, chat isolation, persisted results, retry limits,
   stale-event rejection, and exactly one terminal stream outcome.
3. Do not silently add provider retries or expand the three-candidate return
   lookup bound. Bound concurrency across simultaneous requests, not just within
   a single request.
4. Never log prompts, credentials, authenticated URLs, departure tokens, or raw
   provider responses in performance telemetry.
5. Record cancellation and errors separately from successful latency. A timeout
   reduction is not a performance win if it discards valid results.
6. No model switch, quote caching, broad infrastructure replacement, or additional
   activity parallelism in the initial delivery.

## Phase 1 — Establish trustworthy measurements

Primary files: `agents/supervisors/travel/main.py`, `graph/graph.py`,
`graph/tools.py`, `agents/travel/serpapi_tools.py`, provider executors/server
entrypoints, `frontend/src/hooks/useAgentAPI.ts`, the chat result render path,
and a new bounded benchmark script under `scripts/`.

Implementation:

- Use monotonic durations (`perf_counter`) inside each Python process and
  `performance.now()` in the browser. Never subtract monotonic clocks from
  different processes or machines.
- Track API acceptance, conversation-lock wait, state load/save, intent,
  extraction, A2A round trip by category, outbound search, each return lookup,
  hotel search, activity search, formatting, first useful result, and completion.
- Record provider queue time separately from network execution time. Nested
  durations overlap; report the critical path rather than adding every span.
- Carry an opaque correlation ID through supported A2A metadata without altering
  the user prompt. Verify SDK metadata propagation first. If unavailable, keep
  supervisor A2A durations and provider aggregates separate and label that limit.
- Request IDs belong in diagnostic records, never unbounded metric labels.
  Allowed aggregate labels: stage, scenario/category, outcome, warm/cold, mode.
- Browser measurements distinguish first status, first usable card (after the
  render commit), final response received, and final response visibly rendered.
  This reveals any UI animation delay without confusing it with API latency.
- Keep metrics out of travel result schemas and stored user prose. Use bounded
  structured logs/benchmark artifacts initially; do not require a new telemetry
  service or turn on broad prompt tracing.
- Benchmark normal conversation-backed streaming, not only the legacy prompt
  endpoint. Measure non-streaming separately; completed-request replay is its
  own scenario, not a new provider search.

Baseline scenarios: activity-only, hotel-only, one-way flight, round-trip flight,
flight/hotel with explicit stay dates, ambiguous overnight stay, default full
trip, clarification, saved explanation, hotel retry, provider failure, and stop.

Acceptance:

- Every completed, failed, timed-out, and cancelled request has an outcome and
  duration; concurrent chats cannot mix metrics.
- Metrics tests use controlled clocks/events, not fragile millisecond assertions.
- Fixture baseline separates scenario, cold/warm state, and concurrency (1 and 3
  active requests). Report sample count and errors alongside median/p95.
- Run at least 30 fixture samples per selected performance scenario. A small live
  sample is descriptive only; do not present its p95 as a production guarantee.
- Instrumentation overhead must be measured with fixtures; investigate an
  increase greater than 5% or 10 ms, whichever is larger.

## Phase 2 — Concurrent return-flight enrichment

Primary files: `agents/travel/serpapi_tools.py`, new focused provider-concurrency
tests, and the flight fixture provider.

Implementation:

- Select exactly the same cheapest up-to-three outbound candidates and departure
  tokens as today. Only the independent return lookups run concurrently.
- Each worker returns data associated with its original candidate; apply results
  deterministically so completion order cannot attach the wrong return leg or
  alter stable output ordering.
- Add a configurable per-process limiter around actual SerpAPI calls. Start with
  at most three in flight per flight-agent process; document that replicas
  multiply this ceiling. Do not hold one limiter while waiting on another.
- Preserve existing error semantics initially. On fatal error/cancellation,
  cancel and await sibling workers; do not introduce best-effort quote selection
  as an unreviewed side effect of the speed change.
- Keep provider timeouts and caller deadlines explicit. Include limiter waiting
  within the caller's deadline and avoid orphaned work after cancellation.
- Keep a serial fallback via a configuration value of one.

Acceptance:

- Gates/barriers prove lookups overlap and the configured cap is respected across
  two simultaneous searches; total calls are unchanged.
- Zero, one, three and more-than-three candidates, missing tokens, out-of-order completion, malformed
  results, rate-limit errors, timeout and cancellation have deterministic tests.
- Correct outbound-token/return association and total prices match the serial
  baseline on identical fixtures.
- A controlled equal-delay three-lookup benchmark targets at least a 40% reduction
  in the return-enrichment stage. This is a fixture target, not a live promise.

## Phase 3 — Reuse provider HTTP connections

Primary files: `agents/travel/serpapi_tools.py`, flight/hotel/activity server
entrypoints, the supervisor lifespan for direct directions calls, and test
dependency injection helpers.

Implementation:

- Own one shared async HTTP client per service event loop, with explicit startup
  and shutdown and limits consistent with the request concurrency ceiling.
- Manage ownership around both HTTP and NATS lifetimes; do not close the client
  while transport tasks remain active. Close it once on graceful shutdown.
- Inject test clients or a client factory. Never reuse a module-global client
  across unrelated `asyncio.run()` loops; support standalone helper invocations
  with a clearly scoped fallback and no leaked client.
- Preserve authenticated-URL redaction and existing provider error messages.
  Configure connection, read, write and pool timeouts deliberately; retain the
  outer request deadline. Do not add retries in this phase.

Acceptance:

- Repeated calls reuse the intended client; lifespan, direct-call fallback,
  multiple event loops, cancellation, shutdown and HTTP/NATS modes are tested.
- No cross-request credentials or query parameters leak through client state.
- Record connection reuse/warm-call timings with a controlled local server.
  Live benefit is measured rather than assigned an arbitrary percentage target.

## Phase 4 — Overlap flights and hotels when dates are explicit

Primary files: `graph/graph.py`, `graph/progress.py` if needed, partial-search
tests, preference tests, stream tests, and fixture provider delay controls.

Eligibility: full-trip request, validated explicit hotel check-in AND checkout,
complete flight parameters, and no unresolved clarification. Otherwise preserve
the sequential flow. Do not infer a stay date to unlock concurrency.

Implementation:

- Start one flight task and one hotel task after validation; emit each category's
  progress and valid result as it becomes ready. Keep category ordering flexible.
- Pair and assess only after both complete. Preserve all date, budget, lodging,
  privacy, timing and count checks.
- If hotels fail/return nothing/are filtered out, retain successful flights and
  the existing bounded hotel-retry state.
- Explicitly define the reverse failure: successful hotels plus failed/empty
  flights must survive as separate hotel cards with no combined total. Explain
  that flights need a new search; do not invent an unsupported retry-flight API.
- Cancel and await pending local tasks on stop, disconnect, fatal error or request
  timeout. Verify remote A2A cancellation behavior; a sent provider request may
  still finish and incur usage. Do not promise cancellation refunds.
- Keep activities in their existing later stage for this delivery.
- Flag the concurrency path so the old sequence can be restored independently.

Cost tradeoff: parallel hotels can consume a hotel call even when flights later
fail, whereas the sequential path would skip that call. Report this explicitly
in failure benchmarks. Successful-path request counts must remain unchanged.

Acceptance:

- Test either completion order, each independent failure, both failures, filters,
  stop/disconnect and cancellation, plus persisted/reloaded partial results.
- Implicit or ambiguous hotel dates never start an early hotel provider call.
- No activities appear when excluded; no combined total appears for unpaired
  results; request replay does not duplicate concurrent calls.
- With equal controlled provider delays, target at least a 35% reduction in the
  combined provider stage. Validate first useful card separately from completion.

## Phase 5 — One model decision for ordinary travel searches

Primary files: `graph/models.py`, `graph/graph.py`, model-selection tests,
conversation fixtures and conversation-quality evaluation.

Implementation:

- Behind an independent flag, use one structured envelope containing intent,
  optional travel parameters and clarification. A valid travel-search decision
  feeds the existing validation/dispatch directly, avoiding a second extraction.
- Keep deterministic routes for replay, retry hotels, saved explanations, hotel
  replacement and supported comparisons. Preserve mixed explanation/search
  semantics and corrections to saved preferences.
- Reuse existing extraction guidance, party/budget validation, explicit-scope
  overrides and date validation. Do not let an intent label bypass those checks.
- Respect existing role-specific model overrides. If intent/extraction roles are
  configured differently, default to the old path until explicitly configured
  for the combined role; never silently ignore a role override.
- Bound any fallback to the existing two-stage path to once, only for defined
  schema/model failures. Record fallback rate and extra calls. Ambiguous user
  input asks a clarification; it does not trigger repeated model guessing.
- Keep general-response generation separate. Do not claim every possible request
  becomes a single model call.

Acceptance:

- Ordinary valid travel search uses one decision call rather than intent plus
  extraction. Deterministic follow-ups do not gain model calls.
- Fixture transcripts cover abbreviated replies, contradictory constraints,
  destination/date changes, scope exclusions, lodging/date preferences, hotel
  replacement, comparisons, greetings and unsupported combinations.
- All existing conversation expectations pass, fallback is bounded, and model
  configuration tests remain valid. Compare tokens as well as call count: one
  larger call is not automatically cheaper or faster.
- Enable by default only after bounded live comparison demonstrates preserved
  routing/extraction quality and an improvement in measured end-to-end latency.

## Validation, rollout and agent work allocation

Deliver separate reviewable changes in this order:

1. Timing instrumentation and reproducible baseline.
2. Return-search concurrency.
3. Shared HTTP lifecycle.
4. Explicit-date flight/hotel overlap and reverse partial-result handling.
5. Combined decision experiment, then an evidence-based default decision.

Use Luna implementers with narrow ownership and the orchestrator as integrator
and reviewer. One agent owns provider code; a second owns telemetry/benchmark
code; a third can review contracts/tests. Do not let multiple agents edit
`graph.py` concurrently. Give each agent expected behavior, invariants, owned
files, exact test cases and a prohibition on unbounded live calls.

For each phase: focused unit/concurrency tests, relevant Docker integration tests,
lint/type checks when affected, and comparison against the recorded baseline.
For the combined release: full Docker backend coverage gate, frontend checks,
Chromium/Firefox suite, restart persistence and conversation evaluation.

Concurrency tests should use barriers and recorded active-task counts. Benchmark
elapsed time separately with broad tolerances; do not make normal CI depend on
unstable external-network latency.

Live validation is a separately bounded execution step, not part of this planning
task. Proposed initial budget: at most 12 total live requests, split between old
and new configurations using matched scenarios; include all fallback/provider
calls in the accounting. Stop on correctness regression, quota/rate-limit errors,
or exhausted budget. Report all samples, provider cache/warm-state effects and
unknown costs. Do not run both model paths on every real user request.

Report first useful card and completion median/p95 by scenario and sample size,
quality failures, timeout/cancellation rate, model/provider call counts, and token
usage when available. Success requires unchanged correctness, bounded call counts,
and demonstrated benefit on the intended path. Keep low-sample live findings
descriptive; larger production observation is needed for a reliable live p95.

Rollback: set return concurrency to one, disable flight/hotel overlap, or disable
the combined-decision flag independently. Shared-client lifecycle changes revert
as a separate commit. Keep instrumentation so regressions remain diagnosable.
Do not roll back the existing preference, privacy or date correctness fixes.

## Deferred work

- Provider quote caching requires explicit TTL, stale-price labels, cache keys
  covering all search/party parameters and freshness rules. Completed-request
  replay already exists and must remain distinct from reusable quote caching.
- Activity parallelism changes failed-trip provider spend; evaluate after the
  explicit-date two-category path is measured.
- Bundle splitting, text animation changes, A2A client reuse and infrastructure
  tuning require measured attribution first. They are not assumed to dominate
  travel search latency.

## Technical references

- [HTTPX async client pooling and lifecycle guidance](https://www.python-httpx.org/async/)
- [Python concurrent task and cancellation semantics](https://docs.python.org/3/library/asyncio-task.html)

These references support implementation mechanics, not a promised speedup.

## Plan review outcome

The orchestrator inspected the API stream, conversation persistence path, graph
routing/dispatch, provider search helper, server lifecycles and fixture evaluation.
A Luna reviewer independently inspected these paths and the existing tests.

Review findings incorporated:

- Measure browser-visible cards separately from server completion and fixture latency.
- Preserve existing fatal return-lookup behavior during the concurrency change;
  partial-return acceptance would be a separate product decision.
- Gate parallel hotels on both explicit validated stay dates, and test both
  directions of partial failure as well as incremental streaming and reload.
- Account for increased hotel calls on failed-flight requests before enabling
  parallel search by default.
- Scope pooled clients to each event loop and both serving modes; defer A2A client
  pooling until its SDK lifecycle/concurrency guarantees are verified.
- Retain deterministic follow-ups and saved-preference validation when combining
  model decisions; measure fallback calls and preserve role overrides.

Implementation-time checks remain: A2A metadata/cancellation support, actual live
stage timings, and combined-decision model quality. Each has an explicit validation
gate above; none is assumed proven by this planning review. No speedup percentage
is promised for live traffic. No paid benchmark was run.

## Initial implementation and validation — 2026-11-12

Security protections were implemented and verified first; see
[local-security.md](local-security.md). Initial timing instrumentation now covers
API first response bytes and completion, graph classification/extraction, A2A
round trips, and provider queue/request duration. First response bytes are not
the same measurement as the first useful card rendered in the browser. Provider
processes do not yet share a distributed correlation ID.

Return-flight enrichment now performs the same up-to-three candidate lookups
concurrently, with a per-event-loop provider concurrency limit (default 3).
Result association/order and fatal-error behavior are preserved; sibling tasks
are cancelled and awaited on failure. A limit of 1 restores serial behavior.
Concurrency does not add successful-path lookups, though sibling requests may
already have been dispatched when one fails.

The fixture benchmark exercises the actual flight-search code with controlled
100 ms provider delays. Across 30 samples per configuration:

| Return-enrichment mode | Median | p95 |
| --- | ---: | ---: |
| Serial, limit 1 | 301.202 ms | 301.656 ms |
| Concurrent, limit 3 | 100.528 ms | 100.812 ms |

Every sample made four fixture provider calls (one outbound plus three return
lookups) and returned three results. This is approximately a 66.6% reduction in
the fixture return-enrichment stage, not a measured live end-to-end improvement.
Raw results are in the ignored local artifact
`.runtime/ci/return-latency.ndjson`.

Validation passed: 210 backend tests, 130 browser tests, configured coverage
92.44%, frontend checks/build, persistence checks and 10 fixture conversation
evaluations. No paid API benchmark was performed.

Remaining measurement work includes browser card-render timing, distributed
correlation, persistence/lock timing and a live baseline. HTTP client pooling,
parallel flight/hotel search and combined model decisions remain deferred to
their validation gates above; they are not implemented by this initial change.

## Phase 3 execution record — 2026-11-12

The flight, hotel and activity services now own an event-loop-local HTTPX client
across their HTTP and NATS lifetimes. The supervisor owns its client through its
FastAPI lifespan for direct directions calls. Standalone helper calls retain a
scoped client fallback; unrelated event loops never share a client. Nested owners
share the client and the final owner closes it. Shutdown waits for serving-task
cleanup before closing the pool, including NATS-only mode.

Connection and keepalive limits match `TRAVEL_PROVIDER_CONCURRENCY` (default 3,
valid range 1–10). Connect, read, write and pool timeouts remain 60 seconds. No
retries, new provider calls, shared default credentials or query parameters were
added. Response cookies are rejected so they cannot affect later searches.
Existing request admission and security controls remain enabled.

The implementation follows [HTTPX scoped-client guidance](https://www.python-httpx.org/async/)
and [connection-limit configuration](https://www.python-httpx.org/advanced/resource-limits/).

Validation:

- Docker backend: **235 tests passed**, including request isolation, response
  cookie rejection, separate event loops, nested ownership, cancellation during
  shutdown, HTTP/NATS lifecycle and supervisor lifespan tests.
- Configured branch-inclusive coverage: **92.77%**; new provider client module
  98%, service lifecycle module 95%. Python lint and diff whitespace checks pass.
- Real fixture HTTP/NATS stack: restart persistence passed; **10/10** conversation
  evaluations passed with zero failed checks. No paid model/provider calls.
- Frontend code was unchanged; the browser suite was not rerun for this phase.
- Updated local containers are healthy and the deployed no-paid security probe
  passed. Recreating the supervisor changed its container address; restarting
  the UI refreshed nginx's cached upstream address and resolved a transient 502.
  When recreating the backend independently, restart the UI proxy afterward.

Run `python scripts/benchmark_provider_pool.py` for a local HTTP/1.1 experiment.
The measured run used 20 independent lifespans per mode, five calls each:

| Mode | Requests | TCP connections | Repeated-call median | Repeated-call p95 |
| --- | ---: | ---: | ---: | ---: |
| Per-call fallback | 100 | 100 | 3.766 ms | 4.728 ms |
| Pooled | 100 | 20 | 0.406 ms | 0.758 ms |

All five requests within each pooled lifespan reused one connection. Cold-call
medians were 3.868 ms fallback and 3.785 ms pooled. Cold pooling measurements
include client construction; fallback measurements include each call's client
construction and closure. These localhost measurements prove reuse and reduced
local overhead, not a live end-to-end speedup. Real TLS, provider latency and
model time are absent. A paid live comparison remains unperformed.

Next: collect a bounded live baseline before choosing the next optimization;
flight/hotel overlap and combined model decisions remain subject to the gates
above. Pooling can be rolled back independently without changing security.
