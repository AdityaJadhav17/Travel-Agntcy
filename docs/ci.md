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
| Python | Ruff on application/configuration/scripts and current travel tests; unit/API regressions; JUnit and coverage XML; 90% branch-inclusive coverage floor on the conversation repository/turn coordinator and budget decisions |
| Python audit | `uv export --locked --group ci` and pip-audit on the resolved runtime and CI dependencies; any reported advisory blocks |
| E2E | Chromium and Firefox against nginx, FastAPI, SQLite, three agent services and NATS; separate API restart-persistence probe |
| Infrastructure | actionlint, redacted Gitleaks source scan, tracked-file hygiene, strict Helm lint, builds of all five production images |

GitHub Actions are pinned to full commit SHAs. Jobs have read-only repository
permissions, explicit timeouts, and no application secrets. Superseded PR runs
are cancelled. Reports, traces, screenshots, videos on failure, and CI service
logs are retained for 14 days. Dependabot checks Actions, npm, uv and Docker
weekly. No audit findings are allowlisted or configured to continue on error.

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
budget retention/revision/removal, and both overlapping and completed retries. Dates are generated in the future.
No test uses a real user's conversation or the developer's conversation volume.

## Run locally with Docker

From the repository root (Docker Compose v2 required):

```sh
docker compose -p travel-ci -f compose.ci.yaml build python-checks frontend-checks ui e2e
docker compose -p travel-ci -f compose.ci.yaml run --rm --no-deps frontend-checks
docker compose -p travel-ci -f compose.ci.yaml run --rm --no-deps python-checks uv run --no-sync ruff check agents common config services scripts tests/travel tests/e2e
docker compose -p travel-ci -f compose.ci.yaml run --rm --no-deps python-checks uv run --no-sync pytest tests/travel -q --junitxml=/reports/pytest.xml --cov --cov-config=.coveragerc --cov-branch --cov-fail-under=90 --cov-report=term-missing --cov-report=xml:/reports/coverage.xml
docker compose -p travel-ci -f compose.ci.yaml up -d --no-build --wait --wait-timeout 180 ui
docker compose -p travel-ci -f compose.ci.yaml run --rm --no-deps e2e
docker compose -p travel-ci -f compose.ci.yaml exec -T api uv run --no-sync python scripts/ci/check_persistence.py seed
docker compose -p travel-ci -f compose.ci.yaml restart api
docker compose -p travel-ci -f compose.ci.yaml up -d --no-build --wait --wait-timeout 120 api
docker compose -p travel-ci -f compose.ci.yaml exec -T api uv run --no-sync python scripts/ci/check_persistence.py verify
```

Audits require network access to advisory registries (outside the internal E2E
network):

```sh
docker compose -p travel-ci -f compose.ci.yaml run --rm --no-deps frontend-checks sh -c 'npm audit --audit-level=low --json > /reports/npm-audit.json'
docker compose -p travel-ci -f compose.ci.yaml run --rm --no-deps python-checks uv export --locked --group ci --no-emit-project --no-hashes -o /reports/python-requirements.txt
docker compose -p travel-ci -f compose.ci.yaml run --rm --no-deps python-checks uv run --no-sync pip-audit -r /reports/python-requirements.txt --no-deps --disable-pip --format json -o /reports/python-audit.json
```

`--no-deps --disable-pip` audits the fully resolved export without installing or
resolving packages a second time. `--locked` fails on manifest/lockfile drift;
image builds also restore dependencies with `uv sync --locked` and `npm ci`.
Audit-tool/network failures also fail the check.

Reports appear under `.runtime/ci/` (ignored by Git). View
`.runtime/ci/playwright-report/index.html` for browser results. Capture logs before
cleaning the isolated stack:

```sh
docker compose -p travel-ci -f compose.ci.yaml logs --no-color
docker compose -p travel-ci -f compose.ci.yaml --profile e2e down -v --remove-orphans
```

The exact project name and file above target **only CI test data**. Do not run
volume cleanup against the normal developer Compose project.

## Initial audit blocker

On 2026-09-24, npm audit reported zero vulnerabilities. The locked Python runtime
and CI dependency export reported **403 advisories across 42 packages**. The gate
intentionally fails until those findings are remediated. Counts reflect scanner
reports, not an assessment that every advisory is exploitable in this app.

Remediation needs a separate compatibility pass: inspect the JSON report's fixed
versions, update direct dependencies in coherent groups (agent SDK/LangChain/model
adapters together), remove unused dependencies where verified, regenerate the
lock, then rerun unit/E2E tests and the opt-in live-provider smoke test. Review
unfixed findings individually; do not lower the audit threshold to get green.

The old coffee/logistics integration tests reference services outside this travel
application and are not part of the gate. The current regression suite is
`tests/travel`, with browser fixtures in `tests/e2e` and journeys in `frontend/e2e`.

References: [GitHub Actions security](https://docs.github.com/en/actions/reference/security/secure-use),
[Playwright CI](https://playwright.dev/docs/ci-intro),
[pip-audit](https://github.com/pypa/pip-audit),
[uv with Dependabot](https://docs.astral.sh/uv/guides/integration/dependabot/).
