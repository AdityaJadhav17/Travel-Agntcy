# Measuring travel search latency

Open http://localhost:3000, unlock the app, and keep the tab and chat selected
throughout a search. Open DevTools → Console. Before a batch, run:

```js
window.__travelLatency.clear()
```

Submit a complete trip request. When it finishes, run:

```js
window.__travelLatency.print()
```

For counts, median and range across successful, eligible runs:

```js
window.__travelLatency.summary()
```

Each metric has its own sample count: clarification replies have a final-response
time but no useful-card time. Don't mix different request types when comparing
versions. Error and cancelled rows remain visible in `print()` but are excluded
from `summary()`.

All durations are milliseconds from the accepted submit handler, measured with
the browser's monotonic `performance.now()` clock:

| Field | Meaning |
| --- | --- |
| `firstUsefulCardMs` | First nonempty structured travel result committed and given a browser rendering opportunity |
| `finalResponseRenderedMs` | Successful final response committed and given a browser rendering opportunity, including clarification text |
| `terminalReceivedMs` | Successful terminal result consumed by the client; **not** network EOF |
| `endedMs` | Attempt settled, whether success, error or cancellation |
| `outcome` | Success, error or cancelled; absent while pending |
| `renderExcluded` | The chat/tab became inactive; omit this run from rendering comparisons |
| `backendTimingId` | Server-generated ID matching supervisor timing logs |

Rendering uses two animation frames after a React commit. This approximates a
paint opportunity; it does not measure pixels reaching the display, viewport
visibility, scrolling completion or every animation. Empty result sets and text
clarifications do not count as useful structured cards. A missing milestone is
not zero milliseconds. The client intentionally stops reading at the terminal
event, so DevTools' network duration can differ.

For a small comparison, use the same complete request in fresh chats, keep the
same model and configuration, and record 5–10 runs per version. Separate first
runs from subsequent runs and alternate versions when practical. Compare median
and range, and report sample counts and errors separately. Provider caching,
network conditions and model variability can affect results. Live searches cost
model/provider usage; this instrumentation adds no paid calls.

Retrieve a copy of the records with `window.__travelLatency.getMeasurements()`.
Only the newest 100 attempts are retained in memory, and reload clears them.
Diagnostics contain no prompts, travel details, keys or conversation IDs and
are not sent to an analytics service or saved in browser storage. Existing chat
history storage is separate. Retried requests get new measurement IDs even when
the app reuses its request ID for safe recovery.

To investigate a slow run, match `backendTimingId` to `request_id` in the
supervisor's `travel_request_timing` and `travel_timing` log records. These show
total API time, first bytes, model stages and A2A round trips. Provider processes
do not yet propagate that ID; this is not a distributed trace. Browser durations
and server durations have different start boundaries and must not be added.

## Validation — 2026-11-13

Docker validation passed: 235 backend tests, 142 Chromium/Firefox tests,
frontend lint/format/type checks and production build, plus Python lint. Browser
tests cover empty/first useful results, successful completion, clarification,
errors, Stop, background-chat exclusion, reload reset and retention of completed
samples when starting a new chat. Validation used synthetic streams and fixture
providers, with no paid searches. The existing frontend bundle-size warning
remains. No live latency improvement is inferred from these tests.
