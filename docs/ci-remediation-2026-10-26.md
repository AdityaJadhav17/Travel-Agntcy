# CI remediation, 2026-10-26

## Cause

The [October 26 scheduled main run](https://github.com/AdityaJadhav17/Travel-Agntcy/actions/runs/40347394902)
at `dc67b2c0cc9820df5ddb956d997f01ed0015c7c0` failed the Python dependency audit
and the aggregate quality gate. All other jobs passed remotely.

The exact NLTK exception expired on October 26 at 00:00 UTC. A fresh full scan
also found three filelock advisories, one OpenTelemetry API advisory and one
setuptools advisory. The expired policy caused the policy runner to reject the
scan before accepting any findings; renewing it alone would not fix the newly
reported packages.

## Fix

| Package | Previous lock | Updated lock |
| --- | --- | --- |
| nltk | 3.10.3 | 3.10.4 |
| filelock | 4.0.3 | 4.2.4 |
| opentelemetry-api | 1.37.0 | 1.45.1 |
| setuptools | 84.0.0 | 84.2.1 |
| agntcy-app-sdk | 0.4.6 | 0.4.7 |
| ioa-observe-sdk | 1.0.24 | 1.0.34 |

Add patched minimums for the affected packages and regenerate the lock. The
old Observe SDK pinned OpenTelemetry API and exporters to 1.37.0. The App SDK's
0.4.7 patch release selects Observe SDK 1.0.34, which permits patched tracing
packages without dependency overrides. Retain A2A SDK 0.3.2 and the existing
application APIs; update the OpenTelemetry SDK/exporters/instrumentation family
and native SLIM binding as required by the SDK's declared dependencies.

[NLTK 3.10.4 was released on October 21](https://pypi.org/project/nltk/3.10.4/).
The published wheel's model persistence code now uses pathsec-aware file
access, and the full scanner reports no finding for this version. The GitHub
advisory page still says no patched version while listing affected versions
through 3.10.3, so the evidence here is the published source and fresh scan.

Remove the expired NLTK exception: `scripts/ci/audit_exceptions.json` is now an
empty list. No approval was renewed. The scanner still checks every resolved
package, retains its complete raw report, rejects new findings and enforces
expiry for any future explicit exception. Coverage and quality gates are
unchanged. Both native and Linux audit results are `passed`, with no
accepted or blocked findings.

## Validation

- Native and Linux complete audits report no known vulnerabilities and no
  exceptions. Ruff and all 162 Python tests pass in both environments with
  96.57% branch-inclusive targeted coverage against the unchanged 90% threshold.
- The production UI and all four production Python images build from the lock.
- A separate tracing smoke check exercises real SDK initialization, synchronous
  tool and asynchronous graph/agent decorators, and shared parent trace IDs
  using an in-memory span exporter with product telemetry disabled. It passes
  natively and in Linux; the Linux check has external networking disabled.
- Workflow lint, source hygiene, the Playwright version guard and the redacted
  source credential scan pass.
- All 30 Chromium and Firefox journeys pass using real A2A/NATS agent services
  with deterministic provider/model fixtures. Conversation persistence passes
  across an API restart, and the fixture evaluation passes 10/10 scenarios with
  zero failed checks or incorrect assumptions. This does not measure live-model
  accuracy or real provider cost.

The tracing smoke logs an upstream optional SageMaker instrumentor warning
about the unsupported `enrich_token_usage` constructor argument. The travel app
does not use SageMaker; the tested agent/graph/tool spans export successfully.
This check does not claim SageMaker instrumentation compatibility. Live SLIM
transport and paid provider/model integrations are outside this CI verification.

Local logs are under `.runtime/oct26-*`; Linux audit, coverage and JUnit
artifacts are under `.runtime/ci/oct26-*`. The before scan retains all six
findings. The after scan retains the complete clean dependency report. The
isolated `travel-ci` containers and their test volume are removed after testing.

## Handoff

Changes are uncommitted on `codex/ci-remediation-oct26`, based on the main commit
above, following the maintainer's preference to commit and push personally.
No remote branch, pull request or repository setting was changed. Publish the
fix and require a fresh successful GitHub CI run before merging.
