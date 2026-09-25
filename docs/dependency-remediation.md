# CI remediation, 2026-09-24

## Fixed

- CI creates `.runtime/ci` and both browser report directories as the runner user
  before any Docker bind mount. Previously Docker created the parent as root on
  Linux, and host-side `services.log` redirection failed with permission denied.
  `scripts/ci/check_report_permissions.py` reproduces the failure using UID 1001
  and verifies both log writing and artifact reading after preparation. It runs
  in a disposable Linux container in CI; it never changes checkout ownership.
- Updated the runtime and CI lockfile to patched versions, including FastAPI,
  Starlette, LiteLLM, LangChain/OpenAI, crypto/HTTP libraries, and pytest/coverage.
  The AGNTCY application, identity and A2A SDK versions remain unchanged.
- Removed unused Google ADK, alternate LangChain/LlamaIndex model adapters,
  LangGraph supervisor, duplicate dotenv/MCP declarations and the unused direct
  Azure-core pin. Repository imports and the installed AGNTCY/Observe SDK sources
  do not use these adapters. Google ADK's old constraints prevented a patched
  Starlette release. The configured model still uses ChatLiteLLM/ChatOpenAI.
- Updated the optional OASF Python generator from 32.1 to 33.5 while retaining
  schema revision `8b2bf93bf8dc`. Its old generated dependency constrained protobuf
  below 6.33; protobuf is now 6.33.6, with a patched minimum of 6.33.5.

The full pip-audit scan reports **1 finding in 1 package**, down from 403 findings
across 42 packages. Its raw report retains that finding. On September 25, 2026,
the maintainer approved the narrow, expiring CI exception described below.

## Remaining upstream vulnerability and approved exception

`nltk==3.10.3`: **CVE-2026-81726 / GHSA-8mgp-746c-j5xp / PYSEC-2026-3740**.
The [upstream advisory](https://github.com/nltk/nltk/security/advisories/GHSA-8mgp-746c-j5xp)
lists no patched version. PyPI's latest release, including a check for newer
prereleases, is 3.10.3. Upstream has partial source hardening, but the advisory
still covers the published release.

Dependency path: AGNTCY App SDK -> Observe SDK -> LlamaIndex -> NLTK. The Observe
decorators import LlamaIndex workflow classes even though this app uses LangGraph.
Removing NLTK alone would leave required SDK dependencies unsatisfied.

The advisory concerns model-artifact file reads/writes escaping NLTK's `pathsec`
containment. The current travel app does not import NLTK directly, expose model
file upload/loading/training endpoints, or pass user-supplied filesystem paths to
NLTK. Its tools are fixed HTTP travel searches. This is a reachability assessment
of the present application, not a claim that the installed dependency is patched.

The maintainer explicitly approved an exception on **2026-09-25** for
`PYSEC-2026-3740` in `nltk==3.10.3` only. It expires on **2026-10-09 at 00:00 UTC**,
with no automatic renewal. This changes the CI acceptance policy only; it does
not patch the vulnerable dependency or change application functionality.
An upstream fixed release or a separately reviewed replacement of the tracing
SDK's mandatory LlamaIndex dependency is still needed to remove the vulnerability.

The follow-up `scripts/ci/audit_policy.py` implements that bounded policy and is
wired into CI, with the single approved entry in `scripts/ci/audit_exceptions.json`.
It retains the complete scanner report, emits a separate policy decision artifact,
and validates that every applicable exported dependency was actually scanned.
Its 29 regression cases cover expiry, additional advisories, changed versions,
published fixes, malformed/incomplete reports, and scanner failure. The gate
fails again at expiry or as soon as pip-audit reports a patched version. It also
rejects any other advisory or package version. The original scan with an empty
policy exited 1 on the NLTK advisory; the approved policy permits this finding
with a visible warning and a `passed_with_exception` decision.
The complete backend suite now passes 86 tests with 98.68% targeted coverage;
Ruff and actionlint also pass. Application dependencies and runtime behavior
are unchanged by this follow-up.

## Validation

Verified locally in Docker after the dependency updates:

- 57 backend tests passed; targeted branch-inclusive coverage is 98.68%
  against the 90% gate.
- All 12 browser journeys passed across Chromium and Firefox.
- Conversation persistence passed across API restart and container recreation.
- Ruff, actionlint, and the Linux UID 1001 permissions regression passed.
- All five production images built from the locked dependencies, and the
  developer stack started healthy with those images.
- The live-model smoke test passed clarification, destination correction, and
  budget retention, revision and removal. It used and deleted a temporary
  conversation, without making a priced travel-provider search.
- The raw pip-audit scan still exits 1 for the NLTK finding. The CI policy runner
  accepts only the approved exception while it remains valid; its raw JSON report
  is unchanged and its policy decision is uploaded separately.

After enabling the approved exception on September 25, the fresh Docker build,
locked dependency export, and full audit completed successfully. The policy
runner exited 0 with `passed_with_exception`, exactly one accepted finding and
zero blocked findings. All 29 audit-policy regression tests passed again.

JUnit, coverage, browser artifacts, the audit JSON and CI service logs are under
`.runtime/ci/`. The isolated CI stack and test volume were cleaned up; the
developer app remains available at `http://localhost:3000/`.
These are local results; the changed workflow has not been run on GitHub yet.
Optional directory publication and legacy non-travel integrations are not claimed
as tested by the travel regression suite.
