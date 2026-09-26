# CI and local verification

`.github/workflows/ci.yml` runs on pull requests, pushes to `main`, manual
dispatch, and every Monday. It uses Docker for builds, dependencies and tests.
The stable **Quality gate** check requires every job to pass; failed, skipped,
or cancelled jobs cannot produce a green gate. Configure that check as required
in the GitHub branch rules after the workflow has run. Adding a workflow file
does not itself change repository branch protection.

| Check | Scope |
| --- | --- |
| Frontend | ESLint without fixes, Prettier, TypeScript (including E2E sources), Vite production build, npm audit including development dependencies |
| Python | Ruff on application/configuration/scripts and current travel tests; unit/API regressions; JUnit and coverage XML; 90% branch-inclusive coverage floor on conversation storage/turn coordination, budget decisions, recommendation explanations and traveler validation |
| Python audit | `uv export --locked --group ci`, full pip-audit report, and fail-closed enforcement of exact, time-limited exceptions; unapproved findings block |
| E2E | Chromium and Firefox against nginx, FastAPI, SQLite, three agent services and NATS; separate API restart-persistence probe |
| Infrastructure | actionlint, redacted Gitleaks source scan, tracked-file hygiene, Linux report-permission regression, strict Helm lint, builds of all five production images |

GitHub Actions are pinned to full commit SHAs. Jobs have read-only repository
permissions, explicit timeouts, and no application secrets. Superseded PR runs
are cancelled. Reports, traces, screenshots, videos on failure, and CI service
logs are retained for 14 days. Dependabot checks Actions, npm, uv and Docker
weekly. No audit job is configured to continue on error. Python audit exceptions
are recorded in `scripts/ci/audit_exceptions.json`. The maintainer approved one
exception on September 25, 2026: `nltk==3.10.3` / `PYSEC-2026-3740`, expiring
October 9, 2026 at 00:00 UTC. This accepts the finding temporarily; it does not
patch NLTK or change application functionality. Each exception requires
an exact package, version and advisory ID, a reason, and an approval/expiry window
of at most 14 days. They fail at 00:00 UTC on the expiry date and stop applying
as soon as the scanner reports a fixed version. Findings remain in the raw JSON;
accepted findings also emit a workflow warning and appear in the job summary.
Scanner errors, skipped dependencies, incomplete reports, and unused exceptions
fail the check. No exception is inferred from an advisory alias or wildcard.

The credential scan covers the current source tree, not a forensic scan of Git
history. Dependency audits cover application packages, not OS packages inside
container base images. Helm lint/build checks do not prove Kubernetes rollout.

## Deterministic E2E boundary

`compose.ci.yaml` is independent of the developer Compose stack. It publishes no
ports, uses its own named test volume, and does not pass `.env` or real API keys
to containers. Its runtime network is internal, so fixtures cannot accidentally
call paid external services. The browser container shares the UI network namespace
to use `localhost`, preserving the browser secure-context requirements for UUIDs.

Only model extraction/routing and SerpAPI HTTP responses are fixtures, under
`tests/e2e`. Everything between the browser and those boundaries is real, including
API validation, graph execution, A2A/NATS transport, parsing, pricing, persistence,
and UI rendering. Production entrypoints never import the fixtures. These tests
verify application behavior, not language-model quality or live provider uptime.
Keep `scripts/conversation_smoke_test.py` as an opt-in real-provider check.

Journeys cover clarification across turns, destination correction, reload,
separate chats, late responses, deletion, invalid dates/IDs, provider failures,
budget retention/revision/removal, family ages/counts/room clarification and quoted
totals, retained recommendation explanations, and both overlapping and completed
retries. The process-restart probe checks retained recommendation facts, a
selective hotel replacement and family conversation state. Dates are generated
in the future.
The browser journeys also verify a saved flight-only explanation and a bounded
nearby-date airfare comparison after reload, using fixture fares through the
real API and flight agent.
The scored conversation evaluation runs after the API restart and gates CI on
ten deterministic scenarios, including nearby-airport comparisons. Its artifact,
`.runtime/ci/conversation-eval.json`,
includes scenario completion, incorrect-assumption checks, latency and fixture
provider-call counts. These counts are proxies rather than live model tokens or
provider costs.
No test uses a real user's conversation or the developer's conversation volume.

## Run locally with Docker

From the repository root (Docker Compose v2 required):

Create the report directories as the checkout owner before Docker mounts them.
On Linux/macOS, run `sh scripts/ci/prepare_reports.sh`; in PowerShell, run
`New-Item -ItemType Directory -Force .runtime/ci/playwright, .runtime/ci/playwright-report`.
This prevents Docker from creating a root-owned parent that blocks CI log collection.

```sh
docker compose -p travel-ci -f compose.ci.yaml build python-checks frontend-checks ui e2e
docker compose -p travel-ci -f compose.ci.yaml run --rm --no-deps frontend-checks
docker compose -p travel-ci -f compose.ci.yaml run --rm --no-deps python-checks uv run --no-sync ruff check agents common config services scripts tests/travel tests/e2e
docker compose -p travel-ci -f compose.ci.yaml run --rm --no-deps python-checks uv run --no-sync pytest tests/travel -q --junitxml=/reports/pytest.xml --cov --cov-config=.coveragerc --cov-branch --cov-fail-under=90 --cov-report=term-missing --cov-report=xml:/reports/coverage.xml
docker compose -p travel-ci -f compose.ci.yaml up -d --no-build --wait --wait-timeout 180 ui
docker compose -p travel-ci -f compose.ci.yaml run --rm --no-deps e2e
docker compose -p travel-ci -f compose.ci.yaml exec -T api uv run --no-sync python scripts/ci/check_persistence.py seed
docker compose -p travel-ci -f compose.ci.yaml exec -T api uv run --no-sync python scripts/ci/evaluate_conversations.py seed
docker compose -p travel-ci -f compose.ci.yaml restart api
docker compose -p travel-ci -f compose.ci.yaml up -d --no-build --wait --wait-timeout 120 api
docker compose -p travel-ci -f compose.ci.yaml exec -T api uv run --no-sync python scripts/ci/check_persistence.py verify
docker compose -p travel-ci -f compose.ci.yaml exec -T api uv run --no-sync python scripts/ci/evaluate_conversations.py verify > .runtime/ci/conversation-eval.json
```

Audits require network access to advisory registries (outside the internal E2E
network):

```sh
docker compose -p travel-ci -f compose.ci.yaml run --rm --no-deps frontend-checks sh -c 'npm audit --audit-level=low --json > /reports/npm-audit.json'
docker compose -p travel-ci -f compose.ci.yaml run --rm --no-deps python-checks uv export --locked --group ci --no-emit-project --no-hashes -o /reports/python-requirements.txt
docker compose -p travel-ci -f compose.ci.yaml run --rm --no-deps python-checks uv run --no-sync python scripts/ci/audit_policy.py --requirements /reports/python-requirements.txt --report /reports/python-audit.json --decision /reports/python-audit-decision.json
```

The policy runner invokes pip-audit with `--no-deps --disable-pip` to audit the
fully resolved export without installing or
resolving packages a second time. `--locked` fails on manifest/lockfile drift;
image builds also restore dependencies with `uv sync --locked` and `npm ci`.
It also compares the scan's package names and versions against every applicable
requirement in the export. Audit-tool/network failures also fail the check.

Reports appear under `.runtime/ci/` (ignored by Git). View
`.runtime/ci/playwright-report/index.html` for browser results. Capture logs before
cleaning the isolated stack:

```sh
docker compose -p travel-ci -f compose.ci.yaml logs --no-color
docker compose -p travel-ci -f compose.ci.yaml --profile e2e down -v --remove-orphans
```

The exact project name and file above target **only CI test data**. Do not run
volume cleanup against the normal developer Compose project.

## Dependency audit status

On 2026-09-24, npm audit reported zero vulnerabilities. The Python runtime and CI
audit initially reported **403 advisories across 42 packages**. Dependency updates
and removal of unused adapters reduced the same audit to **1 advisory in NLTK
3.10.3**, with no published fix. The maintainer approved the exact, expiring
exception above; all other findings still block. The raw audit retains the
finding, and CI reports `passed_with_exception` while the exception is valid.
See the
[remediation notes](dependency-remediation.md) for the dependency path,
application reachability assessment, and verification results. Counts reflect
scanner reports, not an assessment that every advisory is exploitable in this app.

The old coffee/logistics integration tests reference services outside this travel
application and are not part of the gate. The current regression suite is
`tests/travel`, with browser fixtures in `tests/e2e` and journeys in `frontend/e2e`.

References: [GitHub Actions security](https://docs.github.com/en/actions/reference/security/secure-use),
[Playwright CI](https://playwright.dev/docs/ci-intro),
[pip-audit](https://github.com/pypa/pip-audit),
[uv with Dependabot](https://docs.astral.sh/uv/guides/integration/dependabot/).
