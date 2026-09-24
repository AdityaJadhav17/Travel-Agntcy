# Travel Agntcy

AI travel planning through a LangGraph supervisor and three A2A search agents.
The existing React interface supports full trips, flights, hotels, and activities.

## Architecture

```text
Browser (React 19 / Vite 6, :3000)
  -> FastAPI travel supervisor (:8000)
  -> LangGraph: classify intent -> extract parameters -> search -> reflect/return
  -> AGNTCY A2A messages over NATS (:4222)
      -> Flight agent (:9001) -> SerpAPI Google Flights
      -> Hotel agent (:9002) -> SerpAPI Google Hotels
      -> Activity agent (:9003) -> SerpAPI Google Local
```

The supervisor uses LangChain ChatLiteLLM with the configured LLM provider.
Search agents each run a small LangGraph workflow and return JSON to the supervisor.
The supervisor compares flight fares plus hotel stay totals, applying the existing
hotel rating and arrival-time rules, and returns markdown inside a JSON envelope.
The UI parses that markdown into travel cards; the public response schema is unchanged.
Each request is one independent user turn. Include the full itinerary in follow-ups.

Directories: `agents/` contains the supervisor, specialist agents and search logic;
`common/` contains LLM adapters; `config/` contains settings and optional telemetry;
`frontend/` contains the UI; `docker/` contains image definitions; `tests/travel/`
contains current regression tests. `services/` contains optional identity helpers.
Legacy coffee/logistics tests and OASF records remain as historical examples.
The Helm charts and directory publisher now target the current travel application;
Docker Compose is the runtime verified end to end.

## Prerequisites

For the recommended Docker path, install Docker Desktop with the Linux engine
running and Docker Compose v2 or newer. Python and Node are not needed on the host.

For native development: Python 3.13, uv, Node.js 22 and npm. `.python-version`
selects Python 3.13. Vite 6 does not support the formerly documented Node 16.
The checked-in `uv.lock` and `frontend/package-lock.json` are the install sources;
there is no need to upgrade all dependencies.

## Clone and configure

```sh
git clone https://github.com/AdityaJadhav17/Travel-Agntcy.git
cd Travel-Agntcy
```

Copy `.env.example` to `.env` **only if `.env` does not already exist**:

```powershell
# PowerShell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

```sh
# macOS/Linux
test -f .env || cp .env.example .env
```

Edit `.env` locally. Required variables:

- `LLM_MODEL`: a provider/model identifier available to your account.
- The corresponding provider key, such as `OPENAI_API_KEY`.
- `SERPAPI_API_KEY`: used by all three search agents.

For Azure use `AZURE_API_KEY`, `AZURE_API_BASE`, and `AZURE_API_VERSION`.
For a LiteLLM proxy use `LITELLM_PROXY_BASE_URL` and `LITELLM_PROXY_API_KEY`.
Other providers use their LiteLLM-supported environment variables. Do not put keys
in frontend variables, source files, or commits. Existing `.env` values are preserved.
`OPENAI_MODEL_NAME` is a legacy analytics setting; the travel supervisor reads `LLM_MODEL`.

## Start with Docker (recommended)

From the repository root:

```sh
docker compose config --quiet
docker compose build
docker compose up -d --wait
docker compose ps
```

Open http://localhost:3000. Only NATS, the three agents, the supervisor and UI
start by default. Health checks order startup. The UI is built with npm ci/Vite
and served by nginx; it does not download packages or rebuild on every start.

```sh
docker compose logs -f travel-supervisor flight-agent hotel-agent activity-agent
# After editing source or frontend VITE variables:
docker compose build
docker compose up -d --wait
# Stop core services (does not delete volumes):
docker compose down
```

The frontend API address is a browser URL, not a Compose service name. Override
`VITE_EXCHANGE_APP_API_URL` in the root `.env` before building if necessary.
Compose uses `DOCKER_TRANSPORT_SERVER_ENDPOINT` (default `nats://nats:4222`),
so a native-development `TRANSPORT_SERVER_ENDPOINT=...localhost...` cannot
accidentally redirect containers to themselves.

## Local development

```sh
uv sync --locked
cd frontend
npm ci
cd ..
docker compose up -d nats
```

Run each Python command in its own terminal **from the repository root**:

```sh
uv run python -m agents.flight.server
uv run python -m agents.hotel.server
uv run python -m agents.activity.server
uv run uvicorn agents.supervisors.travel.main:app --host 0.0.0.0 --port 8000 --reload
```

Then run `npm run dev` in `frontend/`. It listens on port 3000. The backend
loads the root `.env`; native transport defaults to `nats://localhost:4222`.
No manual PYTHONPATH export is needed with these module commands. Stop existing
Compose application containers first if their ports are occupied. Stop native
processes with Ctrl+C and NATS with `docker compose stop nats`.

## Service URLs and optional infrastructure

| Service | Address | Purpose |
|---|---|---|
| UI | http://localhost:3000 | Travel chat |
| Supervisor | http://localhost:8000/docs | OpenAPI documentation |
| Health | http://localhost:8000/health | Process liveness |
| Flight agent | http://localhost:9001/.well-known/agent.json | A2A card |
| Hotel agent | http://localhost:9002/.well-known/agent.json | A2A card |
| Activity agent | http://localhost:9003/.well-known/agent.json | A2A card |
| NATS | nats://localhost:4222 | Required A2A transport |
| NATS health | http://localhost:8222/healthz | Broker health |
| Grafana | http://localhost:3001 | Optional dashboards |
| ClickHouse | http://localhost:8123; native port 9000 | Optional trace storage |
| OTEL collector | ports 4317/4318 | Optional telemetry ingestion |
| MCE API / engine | ports 8080 / 8001 | Optional analytics |
| Directory API / health | ports 8888 / 8889 | Legacy agent registry |
| Zot | http://localhost:5555 | Legacy OCI registry |
| SLIM | port 46357 | Alternative transport |
| OASF translation | port 31234 | Optional record translation |

Optional profiles preserve the original infrastructure:

```sh
# Set TRACING_ENABLED=true in .env first to emit traces.
docker compose --profile observability up -d --wait
# Analytics also requires observability:
docker compose --profile observability --profile analytics up -d
# Legacy directory/registry:
docker compose --profile directory up -d
# Shut down all project profiles:
docker compose --profile '*' down
```

`slim` and `oasf-translate` are separate optional profiles. Switching to SLIM
requires `DEFAULT_MESSAGE_TRANSPORT=SLIM` and an appropriate transport endpoint;
the verified basic path is NATS. Optional infrastructure is not required for search.

## API and testing

`POST /agent/prompt` accepts `{"prompt":"..."}` and returns
`{"response":"markdown text","session_id":"..."}`.
`POST /agent/prompt/stream` returns newline-delimited JSON with the same fields.
The UI currently uses the non-streaming route. Other endpoints:
`GET /health`, `/transport/config`, `/suggested-prompts`, `/about`.

```sh
# Credential-free regression tests inside Docker:
docker compose exec -T travel-supervisor uv run --no-sync pytest tests/travel -q
# Real full-trip search with dates 30 days from today (uses API quota):
docker compose exec -T travel-supervisor uv run --no-sync python scripts/smoke_test.py
# Real streaming request:
docker compose exec -T travel-supervisor uv run --no-sync python scripts/smoke_test.py --stream --prompt "What are some things to do in New York?"
```

Native checks:

```sh
uv run pytest tests/travel -q
cd frontend
npm run typecheck
npm run lint:check
npm run build
```

`pytest` defaults to `tests/travel`. `tests/integration` is the retained upstream
coffee/logistics suite and requires agents no longer present in this repository;
it is not a travel acceptance suite. Frontend `npm run check` enforces lint with
zero warnings, formatting, TypeScript and the production build.
No frontend unit-test runner is currently configured.

## Troubleshooting

- Docker pipe/daemon error: start Docker Desktop and wait for the Linux engine.
- Port already allocated: stop the previous instance using that port; do not run
  native and container versions of the same service simultaneously.
- API works but searches fail: all three agents and NATS must be running.
  `/health` only checks process liveness. Run the live smoke test and inspect logs.
- Missing configuration: ACTION REQUIRED: add `LLM_MODEL`, your provider API key,
  or `SERPAPI_API_KEY`. Blank/placeholder keys do not enable live searches.
- Provider 401/403/429: verify the key, model access, billing and remaining quota.
- UI cannot reach API: check its browser-accessible VITE URL and rebuild the UI.
- No hotels: the parser uses numeric SerpAPI prices, including `US$` displays;
  truly empty results still depend on location, dates and upstream availability.
- Use future dates. Requests without required dates return a clarification.
  The UI now remembers each chat; API callers opt in using a conversation ID.
- Tracing is disabled by default. Enable it with the observability profile when
  needed; no collector is required for the core search path.
- Round-trip return details use the outbound departure token. Only the three
  cheapest outbound candidates are expanded to bound API usage; other results
  may show a quoted fare without selected return times. Prices are search quotes.
- Hotels retain nightly `price` and additionally carry `total_price`, `nights`,
  and `check_out_date`; all trip comparisons use the stay total.

SerpAPI contracts: [Flights](https://serpapi.com/google-flights-api),
[Hotels](https://serpapi.com/google-hotels-api), [Local results](https://serpapi.com/local-results).

## Maintenance and Kubernetes

Run frontend maintenance in Docker without mixing Windows and Linux node_modules:

```sh
docker compose -f docker-compose.yaml -f docker-compose.tools.yaml run --rm --no-deps frontend-tools npm ci
docker compose -f docker-compose.yaml -f docker-compose.tools.yaml run --rm --no-deps frontend-tools npm run check
docker compose -f docker-compose.yaml -f docker-compose.tools.yaml run --rm --no-deps frontend-tools npm audit
```

Use `npm run format` or `npm run lint` in that same container for automatic fixes.
Dependencies are restored from package-lock.json; node_modules is not tracked.
See [local Kubernetes deployment](deployment/README.md) for the updated core Helm
chart, and [directory integration](docs/agent_directory_integration.md) for optional
travel agent publication. Compose remains the end-to-end verified runtime.

## Conversation memory

The UI assigns each new chat a stable conversation UUID and sends it with a unique
request UUID to `POST /agent/prompt`. API clients can use:

```json
{"prompt":"Dallas", "conversation_id":"<same UUID for this chat>", "request_id":"<new UUID for this message>"}
```

The response retains `response` and `session_id` (a tracing ID) and adds
`conversation_id` and `trip_state`. Reuse a request UUID only to retry the same
message; the last 10 completed requests are cached. Conflicting concurrent writes
return HTTP 409. Requests without a conversation ID remain stateless and compatible.
The streaming endpoint currently supports only the stateless path.

Conversation messages and extracted trip details are stored in SQLite. Compose
mounts the `travel-conversations` volume at `/data`; restarts and rebuilds retain it.
Do not use `docker compose down -v` unless you intend to erase saved backend memory.
Native runs use `.runtime/conversations.sqlite3`, overridable via
`TRAVEL_CONVERSATION_DB`. The last 40 messages are retained, with up to 12 recent
messages plus structured trip details passed into a graph turn. Older chats from
before this feature display a notice asking you to restate trip details once.

Deleting a sidebar chat calls `DELETE /conversations/{uuid}` and removes its backend
messages, trip details, and cached responses. An ID-only tombstone prevents an
in-flight request from recreating deleted content. Browser history remains local;
there is no cross-device history sync or account authentication in this phase.
This is a local single-user implementation. Kubernetes defaults do not yet mount
persistent conversation storage; use Compose for durable memory in this phase.

See [the improvement plan](docs/conversation-improvement-plan.md) for personas,
user stories, acceptance criteria, and subsequent phases. Budget/passenger-count
enforcement, grounded result explanations, structured cards, and conversational
streaming are still planned; remembering a message does not enforce its constraints.
