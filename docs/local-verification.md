# Local verification - 2026-09-24

## Outcome

The core application is running through Docker Compose. A real browser request
for DFW to New York, October 24-27, 2026, produced outbound and return flight
cards, a three-night hotel quote, and five activity recommendations. The quoted
combined total in that test was $484 ($211 flight + $273 lodging). This is an
observed search result, not a guaranteed booking price.

Both the configured LLM provider and SerpAPI were exercised successfully. No
credentials were missing. The existing .env was not overwritten or committed.

## What broke and what changed

| Root cause | Files / repair |
|---|---|
| Hotel prices such as US$104 failed float conversion and all hotels were discarded | agents/travel/serpapi_tools.py uses numeric extracted_lowest and preserves nightly/stay totals |
| Plan selection compared one hotel night instead of the stay total; total-only rates could be multiplied again | agents/travel/travel_logic.py and supervisor graph use total_price consistently |
| Unrelated one-way return searches were presented as the quoted round-trip itinerary | serpapi_tools.py now uses the outbound departure_token for up to three candidates |
| Empty/error agent responses mixed plain text and JSON; A2A errors could access nonexistent success fields | flight/hotel/activity agent.py files and supervisor graph/tools.py distinguish empty results from failures |
| Reflection could repeat searches without receiving new user input | supervisor graph ends the current turn after an assistant result/clarification |
| Synchronous LLM call blocked the async supervisor | supervisor uses ainvoke; common/llm.py honors streaming and checks LLM_MODEL |
| Stream trace context closed before iteration; whitespace prompts were accepted | supervisor main.py keeps context inside the generator and rejects blank prompts with HTTP 422 |
| Incorrect package list, source copied after package installation, local virtualenv not excluded | pyproject.toml, Python Dockerfiles, .dockerignore; real modules are packaged, dependencies cached before copying source |
| Native NATS endpoint could override container DNS; no startup health ordering | docker-compose.yaml uses separate Docker endpoint override and health checks |
| Mandatory tracing initialized unrelated integrations; extras always started | config/config.py, agent servers and Compose make tracing/profiles optional; server startup failures propagate |
| UI rebuilt/downloaded a server at startup; documented dev port was wrong | Dockerfile.ui builds with npm ci, typechecks, serves nginx; vite.config.ts fixes port 3000 |
| Stale TS types, unused bindings and Node-only logging expression | frontend source fixes, package.json typecheck command |
| Documentation referenced wrong repo, missing native agents, old Python packages and obsolete tests | README, frontend/docker/tests READMEs, Makefile, .env examples, pytest.ini, .python-version |
| No travel regression coverage | tests/travel/test_travel.py; scripts/smoke_test.py for real integration checks |

The external API remains `{response: string, session_id: string}`. Hotel JSON
adds `total_price`, `nights`, and `check_out_date` while keeping nightly `price`.
The initial restoration kept dependency versions unchanged. The follow-up below
updates the npm lockfile and removes generated dependencies from Git tracking.
Python dependencies and uv.lock remain unchanged.

## Initial restoration checks (before maintenance follow-up)

| Check | Result |
|---|---|
| Python 3.13.9, uv 0.11.3, Node 22.18.0, npm 10.9.3 | Available |
| Docker 29.1.5 / Compose 5.0.1 Linux engine | Started and used |
| uv sync --locked | Passed; same lock also installs in Docker |
| npm ci | Passed on host and Docker |
| Backend imports in supervisor container | All four entry modules passed |
| pytest tests/travel -q | 14 passed on Windows and in Docker |
| Frontend TypeScript check | Passed |
| Vite production build | Passed inside Docker; bundle-size warning |
| docker compose config --quiet | Passed |
| docker compose --profile '*' config --quiet | Passed |
| docker compose build | All five application images built |
| docker compose up -d --wait | Six core services healthy |
| GET /health and agent-card endpoints | Passed |
| Real POST /agent/prompt | HTTP 200 with flights, hotel and activities |
| Real POST /agent/prompt/stream, New York activities | HTTP 200, valid NDJSON and session ID |
| Browser frontend-to-backend flow | Real trip submitted; results rendered in existing cards |
| Whitespace validation, CORS, mocked NDJSON contract | Regression tests passed |
| Existing legacy test collection | Failed: missing sentence_transformers; targets absent coffee/logistics agents |
| Frontend lint | Fails: 1016 errors, 4 warnings; 1004 errors are existing formatting-style findings |
| npm install audit | Reported 19 vulnerabilities (2 low, 5 moderate, 12 high); no blanket upgrades applied |

The full-graph regression test replaces external LLM/A2A boundaries. It is not
claimed as live integration evidence; the separate API and browser checks above
used the actual provider, NATS, agents and SerpAPI.

## Maintenance follow-up

Completed the four recommended maintenance improvements using Docker:

- `npm audit fix` updated compatible dependencies (53 packages changed, three added).
  A fresh `npm ci`, `npm run check`, and `npm audit` passed. Audit findings fell
  from 19 to zero. Vite resolved to 6.4.3; no forced major upgrades were used.
- Established the Prettier baseline, corrected imports and unused bindings,
  fixed the Unicode flight-marker regex, and corrected React hook dependencies.
  Modal selection updates node state without rebuilding/resetting the graph.
  `lint:check` now fails on warnings; `check` includes lint, format, types and build.
- Removed 19,758 generated `frontend/node_modules` files from the Git index.
  They remain on disk, ignored. The removal is staged, not committed.
  Docker tooling uses a named dependency volume isolated from host node_modules.
- Replaced missing coffee/logistics Helm dependencies with the six core services,
  added probes and NATS startup ordering, and reference an existing Secret.
  Updated Kind ports, Makefile, helmfile and standalone UI chart. Removed obsolete
  runtime VITE ConfigMaps because frontend URLs are compiled at image build time.
  Directory publishing now selects the three travel cards and supports dry-run.

| Follow-up verification | Result |
|---|---|
| Clean Docker npm install + audit | Passed, zero reported vulnerabilities |
| Frontend lint with zero-warning policy | Passed |
| Frontend format, typecheck, production build | Passed |
| Docker rebuild and Compose health checks | All six core services healthy |
| Backend regression tests in rebuilt image | 14 passed |
| Real browser full-trip request after rebuild | Outbound/return flight, three-night hotel and five activities rendered; console clean |
| Helm lint --strict | Both charts passed |
| Kubernetes schema validation | 27/27 resources valid, zero errors or skipped resources |
| Directory publisher --dry-run in Docker | Exactly flight, hotel and activity cards; no publication |
| Git diff whitespace check | Passed |

See [deployment instructions](../deployment/README.md) and
[directory integration](agent_directory_integration.md) for reproducible commands.
No credentials were changed or published. No commits or remote pushes were made.

## Remaining limitations

- Helm templates have not been installed in a live Kubernetes cluster.
- Optional observability, identity, SLIM, analytics and directory publication
  remain unverified end to end. The pre-existing unhealthy registry containers
  were stopped during initial restoration; their data was not deleted.
- Vite reports a roughly 549 kB main bundle; code splitting is future work.
- An upstream A2A SDK deprecation warning remains in tests.
- The UI still parses Markdown. A versioned structured response schema remains
  future work. Conversation memory is implemented in the follow-up below.

## Conversation implementation follow-up

See [personas, stories, and phased plan](conversation-improvement-plan.md).
Phase 1 now persists local chat turns and structured trip state, handles short
clarification replies and corrections, validates missing/invalid dates before
search, and preserves memory through Docker recreation with a named volume.

- 29 backend tests passed in Docker, including concurrent writers, persistence,
  isolation, idempotent completed requests, rollback, deletion and date validation.
- Frontend lint (zero warnings), formatting, types and build passed.
- A real browser conversation supplied destination, origin, and dates separately;
  the supervisor was recreated before the dates-only turn and retained DFW/JFK.
- Live result: round-trip flights $211 plus a three-night hotel $375, total $586,
  with five activities. This was a time-specific quote, not a booking price.
- `scripts/conversation_smoke_test.py` passed with the actual configured model:
  destination New York, short reply Dallas, then destination correction to Boston.
  Its temporary API conversation was deleted afterwards.
- The implementation retains local browser history and bounds backend context.
  It has no account authentication/cross-device sync; persistent storage for Helm,
  constraint enforcement, result schema and conversational streaming are later work.

Browser chat-switch verification also passed: a pending Tokyo reply completed
in its own chat while the New York result remained unchanged. Reopening Tokyo
asked for its origin, confirming that Dallas did not leak from the other chat.
