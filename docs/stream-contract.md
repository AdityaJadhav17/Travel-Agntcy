# Travel stream contract

`POST /agent/prompt/stream` continues to return UTF-8 NDJSON. No backend field,
endpoint, or event name changed. The browser boundary lives in
`frontend/src/utils/travelStream.ts`; `useAgentAPI.ts` owns HTTP and cancellation.

## Events

| Type | Required data | Consumer behavior |
|---|---|---|
| `status` | nonblank string `component`, string `message` | Update current request's progress. |
| `text` | string `text` | Append transient narrative, never a saved final answer. |
| `result` | nonblank string `component`, validated `travel_result` | Show a transient card. Unsupported versions or malformed cards are ignored; wait for final narrative. |
| `error` with component other than `request` | nonblank string `component`, string `message` | Show component failure as progress; other results may still succeed. |
| `error` with component `request` | string `message`; optional extra fields such as HTTP `status` | Terminal failure. Surface the server message, with a generic retry message when empty. |
| `done` | object `result` with string `response` | Terminal success. Save the validated final result. |

Unknown named event types are ignored for forward compatibility. Extra fields
are ignored. A missing/empty/non-string type, a non-object event, invalid JSON,
or invalid required data on a known event fails with a readable retry message.
Blank lines are ignored. The final JSON line need not end in a newline.

The final response's optional `travel_result` uses the existing versioned card
validator. Invalid/unsupported cards become `null`, preserving narrative fallback.
Optional `budget_assessment` is accepted only with a recognized status, USD
currency, finite positive limit, positive finite or null quoted total, and string
scope/message. Otherwise it becomes `null`. IDs must be strings, `trip_state`
must be an object, and `retry_hotels` must be boolean; invalid optional fields
are omitted. The browser does not coerce objects or arrays into display strings.

## Lifecycle and ownership

The parser starts `pending`. The first `done` changes it to `completed`; the first
request error changes it to `failed`. Malformed required data and EOF without
`done` also fail. Terminal states are immutable: duplicate completion, late text,
late errors, and other trailing lines cannot replace or invalidate the result.
Component errors are deliberately nonterminal.

The reader resolves at a terminal event rather than waiting indefinitely for the
server to close the body. It cancels/releases the reader on completion or failure;
cleanup is initiated without awaiting its promise, so delayed cleanup cannot
hold up a terminal result or its error. Cleanup errors cannot overwrite the result.
Bytes are decoded through one record boundary at a time: invalid UTF-8 after a
terminal record is ignored regardless of network chunk boundaries. Transport failures and invalid UTF-8
produce an actionable interruption message. Intentional AbortError is preserved,
so the existing request-ownership guard can ignore stopped/deleted work.
UTF-8 decoding and line framing work across arbitrary byte/chunk boundaries.

Only validated events reach the per-chat display reducer. Request tokens still
decide whether events belong to the current turn. Stream validation does not
replace ownership checks, server revisions, or request-ID replay. EOF or transport
failure is not proof that server work was rolled back; no automatic retry occurs.

Transport/protocol failures are marked retryable, retaining the original request
identity and user message in the interrupted view. Retry and reload continue to
use that identity until a successful result or definitive request error arrives.
Server request-error events are definitive; HTTP 429 and 5xx remain retryable.

## Regression coverage

`frontend/e2e/travelStream.spec.ts` tests the parser and actual ReadableStream
consumer, including byte-split Unicode, CRLF, unterminated final lines, malformed
payloads, first-terminal precedence, optional-data fallback, EOF, network failure,
intentional abort, lingering bodies, and reader cleanup.

`frontend/e2e/streamContract.spec.ts` checks visible errors, composer recovery,
and persistence of the first complete answer across reload. Existing browser
journeys continue to exercise real application services with fixture providers.
Their `streamObserver.ts` helper observes the actual consumed bytes through a
pass-through transform that preserves streaming and upstream cancellation. This
avoids Chromium's debugger response-body cache, which may disappear when a
completed reader is canceled. It does not replay requests or weaken result
assertions. Malformed/late-event browser tests use the application reader without
this observer.

Run the pure tests in `frontend/`:

```sh
npx playwright test e2e/travelStream.spec.ts --project=chromium
```

For the full Docker suite, see [ci.md](ci.md).

Verification on 2026-11-10: the final Docker run passed all 108 Playwright cases
(46 browser journeys and 62 pure lifecycle/stream cases across the two browser
projects), with no retries needed. Frontend lint, formatting, TypeScript and
production build passed. All 162 Python tests passed with 96.57% configured
coverage. Restart persistence passed, and conversation evaluation passed 10/10
scenarios with zero incorrect assumptions. Reports and logs are in `.runtime/ci/`;
the isolated test stack was removed afterward.

After the review fixes, the rebuilt Docker stack passed all 114 Playwright cases
(46 browser journeys and 68 pure lifecycle/stream cases), plus the 162 Python
regressions and frontend quality checks. New coverage includes repeated failed
recovery followed by reload/replay, unresolved cancellation cleanup on success
and failure, and invalid UTF-8 after `done` at every possible chunk split.
