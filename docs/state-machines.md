# State-machine inventory

Static source audit, 2026-11-10. A machine here means behavior whose allowed
next action depends on earlier events, including states encoded as booleans,
nullable values, counters, timestamps, caches, and control flow. Rows group
repeated implementations; they are not a count of individual React variables.
This covers application source and supporting runtime workflows, not dependency
internals, generated assets, or every possible external-service state.

## Decision

Make asynchronous ownership explicit first. Keep the existing LangGraph and
wire formats. Do not introduce a second workflow framework or rewrite every
boolean into an enum. Independent concerns such as theme and chat selection
should stay independent.

The implemented change is `frontend/src/stores/chatRequests.ts`, used by
`frontend/src/App.tsx`. Previously three separate collections represented pending
requests, request versions, and deleted chats. An aborted request could execute
its unconditional pending-set cleanup after its replacement started, allowing
duplicate submissions and breaking Stop. Deleting an active chat also left the
visible loading state stuck if the DELETE failed.

The new machine makes request ownership atomic, stops before deleting, blocks
new requests while deletion is pending, and restores the previous terminal
state after failed deletion. A successful deletion is terminal for that chat ID.
This gives users reliable Stop/retry behavior, developers one transition owner,
and coding agents a typed contract with executable race regressions.

## Browser machines

Paths in this table are relative to `frontend/src/`.

| Machine / owner | States and events found | Decision / invariant |
|---|---|---|
| Per-chat request ownership — `stores/chatRequests.ts`, `App.tsx` | idle → pending → succeeded / failed / stopped; terminal turn → pending; terminal turn → deleting → deleted or previous state | Implemented explicit machine. Only the current token can publish progress or finish; stale completion is a no-op. |
| Chat selection — `App.tsx`, `components/Sidebar/Sidebar.tsx` | new / selected; select, new chat, delete; selected request may still be pending | Selection must not cancel another chat's work. Background completion updates only its history. |
| Visible response — `stores/chatDisplay.ts`, `App.tsx` | idle / pending with progress, partial cards and text / succeeded / failed / stopped / interrupted / deleting | Implemented a typed per-chat reducer. Selection reads a view without resetting it; background events keep updating their owning chat. Terminal transitions discard transient results. |
| History durability — `stores/chatDisplay.ts`, `App.tsx`, `components/Chat/Messages.tsx` | absent / restored / malformed / dirty / saved / storage failure; pending turn reloads as interrupted | Implemented explicit recovery with persisted request identity. No automatic submission. Retry reuses the original request ID when available; legacy unanswered turns also display recovery. |
| Stream transport — `hooks/useAgentAPI.ts`, `utils/travelStream.ts` | controller registered → HTTP response → validated NDJSON → first done / request error / malformed event / premature EOF / abort → cleanup | Runtime validation and immutable terminal states implemented. Optional-card fallback is preserved. See [stream contract](stream-contract.md). |
| Non-stream request and callback path — `hooks/useAgentAPI.ts` | idle / loading / success / error / canceled; request-ID supersession | Compatibility path. `cancel()` invalidates its request ID but does not clear loading; callbacks/retry notifications need the same stale-owner checks if this path is reactivated. |
| Retry/backoff — `utils/retryUtils.ts`, `utils/patternUtils.ts` | attempt → retryable error → delay → attempt, or success / exhausted / nonretryable | Three retries, exponential delays. Disabled for current travel patterns. Before enabling, exclude cancellation and make delay abortable; preserve request ID across retry. |
| Composer — `components/Chat/ChatArea.tsx` | empty / draft / submitting / disabled; Enter, Shift+Enter, dropdown | Keep submission guard at the request owner as well as the button. Compatibility callback path also has local loading. |
| Modal navigation — `hooks/useModalManager.ts` | closed / identity / badge / policy; open, drill down, Escape/pane/close | Already has a modal discriminator, but node data is separate. A tagged union would prevent details without a selected node. |
| Identity lookup — `hooks/useIdentityDetails.ts`, `components/MainArea/Graph/Identity/IdentityApi.ts` | loading / data / error; retry generation; selection change/unmount invalidates reply | Existing node/attempt matching and active flag protect stale results. Preserve those guards. |
| Graph layout/transport refresh — `components/MainArea/MainArea.tsx`, `utils/graphConfigs.tsx`, `hooks/useViewportAwareFitView.ts` | reset → nodes → delayed edges/labels → fit; visibility and pattern changes; locked / editable | Timers and async label refresh need generation cleanup if graph behavior is changed. These are presentation states, not proof that providers completed. |
| Theme — `contexts/ThemeContext.tsx`, `contexts/theme.ts` | light / dark / system, plus resolved OS preference and transition timing | Already a small independent machine. Preserve saved preference versus resolved theme. |
| Measurement — `hooks/useChatAreaMeasurement.ts` | observing / debounce scheduled / measured / disposed; expanded or compact | Preserve observer and timer cleanup; do not couple measurement to request completion. |
| Sidebar and dropdown controls — `components/Sidebar/`, `components/Chat/Prompts/` | open / closed, hovered item, chosen prompt, fetching prompts / fallback | Local presentation states; no global machine needed. |
| Build-info modal — `components/Navigation/InfoModal.tsx` | no info / fetched info / fetch failure while modal opens/closes | Keep optional metadata failure separate from travel-request failure. |
| Legacy animated messages — `components/Chat/Message.tsx` | loading → character-by-character display → complete | Cursor is retained in a ref; reused components with new text need reset semantics before reuse. |
| Legacy auction stream — `stores/auctionStreamingStore.ts`, `components/Chat/AuctionStreamingFeed.tsx` | idle / connecting / streaming / completed / error; disconnect/reset | Status enum already exists, but reconnect ownership is separate. Not the current travel request owner. |
| Legacy logistics stream — `stores/groupStreamingStore.ts`, `components/Chat/GroupCommunicationFeed.tsx` | streaming / complete / error plus order, execution, session and delivered event | Parallel completion flags and stream ownership need consolidation before reactivation; current travel pattern mappings disable group behavior. |
| Result rendering — `types/travelResult.ts`, `components/Chat/StructuredTravelResultCard.tsx`, `TravelResponseCard.tsx` | recognized structured version/kind → typed card; absent/unknown → narrative fallback; retry/comparison actions | This is chiefly a data discriminator, not an async lifecycle. Keep version fallback and grounded action guards. |

## Backend and agent machines

| Machine / owner | States and events found | Decision / invariant |
|---|---|---|
| Supervisor routing — `agents/supervisors/travel/graph/graph.py` | supervisor → search / general / explain / change hotel / retry hotels / compare dates; reflection → end | Already explicit LangGraph. Keep routing there; no duplicate orchestration layer. |
| Trip clarification — graph, `graph/models.py`, `agents/travel/party.py` | absent / partially extracted / ambiguous / invalid / complete; correction, budget and traveler changes | Validation must precede provider calls. `has_all_params` is not sufficient on its own; preserve deterministic validation. |
| Search components — graph search handlers, `graph/progress.py` | not requested / searching / results / empty / error / timeout; join flights and hotels, optional activities | Distinguish empty inventory from provider failure. Partial success is not overall failure. Progress is scoped through a context-local sink. |
| Retained flights / hotel retry — `graph/partial_searches.py`, graph retry node | no retained facts / fresh / stale ≥5 minutes / invalid or future timestamp; retry → complete / retained again / exhausted | At most two hotel retries; stale facts require flight revalidation. New trip invalidates old partial facts. Already bounded and schema-validated. |
| Recommendation memory — `graph/recommendations.py`, graph explain/change nodes | absent / saved valid / malformed / incompatible kind / stale; explain, replace hotel, new trip | Explanations use saved facts. Hotel replacement preserves the flight and revalidates stale quotes; failed replacements retain the earlier recommendation. |
| Date and airport comparisons — graph comparison handlers, `graph/nearby_airports.py` | eligible / unsupported / candidates pending / partial failures / ranked comparison; bounded concurrency | Alternatives must preserve original trip semantics. Ground-distance lookup is independently fallible. |
| Budget assessment — `graph/budgets.py` | absent / needs currency or scope clarification / supported; unknown / within / over quote assessment | Derived validation states, not a mutable lifecycle. Preserve unknown totals rather than treating them as zero. |
| Turn admission — `agents/supervisors/travel/conversations.py::ConversationTurns` | unqueued → waiting → lock held → released; cancellation at wait/execute | Serializes a chat in one event loop; independent chats proceed concurrently. Not a distributed lock. |
| Durable conversation — `ConversationStore` | nonexistent → revision 0 → revision N; revision mismatch → conflict; delete → permanent tombstone | Optimistic save and deletion are atomic database operations. Deleted IDs cannot be resurrected by load or late save. |
| Request replay — `agents/supervisors/travel/main.py::_conversation_response` | unseen request ID → execute/save → cached; same prompt → replay; changed prompt → 409 | Cache is bounded to 10 request IDs; history to 40 messages. This is bounded deduplication, not universal exactly-once execution. |
| HTTP streaming — `main.py::handle_stream_prompt` | request accepted → task/progress queue → text → done; request error or disconnect → cancellation/cleanup | `done` contains the saved result. Client abort is not proof that remote providers stopped or a threaded save was rolled back. |
| Specialist workflows (three instances) — `agents/{flight,hotel,activity}/agent.py` | parse → validate → provider → format → end; missing parameters / empty / exception | Single-node LangGraphs with implicit substates. Keep specialist JSON success/error compatibility. |
| A2A execution (three instances) — `agents/{flight,hotel,activity}/agent_executor.py` | validate → create/reuse task → invoke → enqueue message; internal error; cancel unsupported | Task creation does not mean completion. Do not advertise working cancellation or richer task transitions without updating consumers and tests. |
| A2A client/transport — `graph/tools.py`, `graph/shared.py` | factory/transport absent → initialized → send → response validation → quotes or error | Lazy transport and request ownership are separate. Preserve structured error propagation and party matching. |
| Provider itinerary enrichment — `agents/travel/serpapi_tools.py` | outbound search → departure token → matching return selection → complete quote / unavailable enrichment | A round-trip return must belong to the same quoted itinerary. Preserve bounded enrichment and complete pricing checks. |
| Credential and LLM lifecycle — `common/llm.py`, `common/litellm_oauth2_openai_provider.py`, `common/chat_lite_llm_shim.py` | configured provider / lazy model; OAuth token absent / cached / expired → refresh; stream metadata / content / done / no generations | Optional adapters have their own cache and stream lifecycles. Do not confuse token expiry with request retry. |
| Optional identity issuance — `services/identity_service_impl.py` | issue → success / failure → delay → retry / exhausted; fetch/verify/validate | Three issuance attempts. Keep separate from travel-agent readiness. |
| Service readiness — agent `server.py` files, `docker-compose.yaml`, deployment charts | process start → transport connection/listener → health; dependency waiting / restart / shutdown | Process liveness and usable external providers differ. Keep Compose health ordering. |
| Legacy logistics domain — `common/logistics_states.py` | received order → handover → customs → payment → delivered, or unknown | Tokens and narrative parsing express a historical workflow; enum alone does not enforce transitions. |
| Publication/verification jobs — `scripts/publish_agent_records.py`, `scripts/ci/`, `.github/workflows/` | prepare → validate → publish/test → pass/fail; retries and report generation | Operational workflows, separate from app runtime. Preserve existing validation gates and avoid changing publish side effects in this refactor. |

## Request ownership contract

`start(chatId, conversationId)` returns a unique object token or rejects duplicate,
deleting, or deleted work. It never reuses a token, even for identical IDs.
`isCurrent(token)` gates progress. `finish(token, outcome)` both checks ownership
and ends the request; callers must publish final state only when it returns true.
`stop(chatId)` invalidates first and returns the token needed to abort transport.
Deletion requires a stopped or otherwise terminal turn. `beginDelete` blocks
new submissions; `finishDelete(false)` restores the previous phase and
`finishDelete(true)` permanently retires that ID for this browser session.

| Event | Allowed source | Destination | Stale/duplicate behavior |
|---|---|---|---|
| start | idle, succeeded, failed, stopped | pending with new token | rejected elsewhere |
| progress | pending with same token | pending | ignored elsewhere |
| finish | pending with same token | succeeded or failed | ignored elsewhere |
| stop | pending | stopped | no-op elsewhere |
| beginDelete | idle, succeeded, failed, stopped | deleting | rejected elsewhere |
| finishDelete success | deleting | deleted | no-op elsewhere |
| finishDelete failure | deleting | prior phase | no-op elsewhere |

The registry is deliberately in-memory. Server revisions and tombstones remain
authoritative across browser reloads. Keep `conversation_id`, `request_id`,
response fields, result versions, and NDJSON event names compatible. Neither
Stop nor UI deletion should claim to cancel already-completed provider billing.

## Verification and next work

`frontend/e2e/chatRequests.spec.ts` exercises stop/restart/late completion,
duplicate admission, independent chats, failed deletion/retry, terminal
deletion, and success/failure completion. These deterministic tests use the
existing Playwright runner without launching browsers or calling providers.
Run `npx playwright test e2e/chatRequests.spec.ts --project=chromium` and
`npm run check` in `frontend/`.

The existing `frontend/e2e/travel.spec.ts` covers browser Stop, chat switching,
deletion, replay, clarification, retry, and persisted recommendations against
the CI integration stack. Run it when that stack is available. The per-chat display
reducer, reload recovery, and stream validation/terminal handling are now
implemented; see
[stream contract](stream-contract.md). Rework dormant legacy
machines only if those features are restored. Static inspection cannot prove
absence of every race or guarantee external-service behavior.

Docker verification completed on 2026-11-10 against rebuilt images: frontend
quality checks and Ruff passed; 162 Python tests passed with 96.57% coverage
over the configured modules; all 42 Playwright cases passed across Chromium and
Firefox (30 browser journeys plus the six ownership cases in each project).
The API restart-persistence probe passed, and conversation evaluation passed
10/10 scenarios with zero incorrect-assumption checks triggered. External model
and provider responses were fixtures; A2A/NATS and application services were real.
Reports are under `.runtime/ci/`. The isolated test containers and test volume
were removed after collecting reports; the developer stack was not changed.


## Per-chat display and reload recovery

`chatDisplay.ts` owns durable conversation history and a map of transient views.
`App.tsx` derives loading, error, animation, partial cards and streamed text from
its selected view. Selection is independent of both request ownership and display
transitions. A background result updates only its own chat, and selecting it
again preserves all progress received while it was hidden. The reducer also
checks the pending token, so queued stale events cannot overwrite a newer turn.
Deletion has a visible pending state and rolls back to the prior settled view on
failure. The composer remains disabled while that chat is being deleted.

Only history is written to `travel_chat_history`; partial cards and streamed
text are never persisted as completed answers. A pending history entry includes
`pendingRequest: { id, prompt }`. After reload, an unanswered user turn becomes
`interrupted`, including legacy records without that metadata. Invalid history
entries are skipped. Completed, failed and stopped turns stay terminal.

The recovery notice offers **Retry last message**. It never auto-submits. Retry
keeps the original user bubble and, when valid saved identity exists, sends the
same conversation ID, request ID and prompt through the existing stream API.
The backend can replay a committed result without duplicating that turn. If the
request was never committed, it executes normally. Existing server limits still
apply: only the latest ten request IDs are cached, and legacy entries have no
request ID. Recovery is therefore not a claim of indefinite exactly-once search
or guaranteed provider cancellation. Browser storage failures retain the existing
visible warning.

Recoverable transport/protocol failures also keep `pendingRequest` and store a
`recoveryError` for display. They do not append an assistant answer or consume the
original request identity. Repeated Retry/reload cycles therefore preserve replay
of a server-committed result; success, Stop and definitive request errors clear
the recovery metadata.

`chatDisplay.spec.ts` checks background isolation, stale-event rejection, reload
migration, terminal restoration and deletion rollback. `chatRecovery.spec.ts`
checks browser selection with partial cards/text, active-stream reload, stopped
chat reload, failed deletion, and real API replay of a result committed before
the browser lost its answer. Controlled stream fixtures make event-order tests
deterministic; the replay test uses the real API and SQLite request cache.

Verification after this follow-up (2026-11-10): all 62 Playwright cases passed
across Chromium and Firefox, including 38 browser journeys and 24 pure lifecycle
cases. Docker frontend quality checks passed. All 162 Python regressions passed
with 96.57% configured coverage; restart persistence passed and conversation
evaluation passed 10/10 scenarios with zero incorrect assumptions. Reports and
service logs were retained in `.runtime/ci/`, then the isolated test stack was
removed. API schemas and backend behavior were not changed.

## Travel preferences and lodging assessments

Travel preferences belong to the saved trip, not a transient stream. Explicit
category exclusions and presentation counts are resolved before provider dispatch;
clarification replies retain them, and an explicit correction updates them. Hotel
stay dates are separate from flight dates and travel with retry/replacement state.

Lodging eligibility has three outcomes: `matched`, `contradicted`, and `unknown`.
Contradicted options cannot satisfy an explicit requirement. Unknown evidence is
visible as unverified; a room count is never evidence of a private room.

Arrival compatibility is independently `compatible`, `incompatible`, or
`needs_confirmation`. A prior-night booking does not establish that a property
will retain a room for late arrival. An uncertain pairing remains provisional in
both its immediate result and saved explanation. Separate quotes do not acquire
a combined total merely because both providers returned results.

See [the implementation and validation plan](travel-preference-fixes-plan.md) for
acceptance cases and verification results for this follow-up.
