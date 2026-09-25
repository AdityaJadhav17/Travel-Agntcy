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

The identical blocking audit command now reports **1 finding in 1 package**, down
from 403 findings across 42 packages. No finding is suppressed; no audit threshold
or quality-gate requirement has been relaxed.

## Remaining upstream blocker

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

The default remains **audit failure**. A policy alternative, requiring an explicit
decision, is a 14-day exception for this advisory and `nltk==3.10.3` only, with the
finding retained in the report and automatic failure after expiry. No exception
has been added. An upstream fixed release or a separately reviewed replacement
of the tracing SDK's mandatory LlamaIndex dependency would remove the blocker.

The follow-up `scripts/ci/audit_policy.py` implements that bounded policy and is
wired into CI, with an **empty exception list** pending a maintainer decision.
It retains the complete scanner report, emits a separate policy decision artifact,
and validates that every applicable exported dependency was actually scanned.
Its 29 regression cases cover expiry, additional advisories, changed versions,
published fixes, malformed/incomplete reports, and scanner failure. The proposed
NLTK-only exception would expire on **2026-10-09 at 00:00 UTC**; it has not been
enabled. The real scan with the empty policy still exits 1 on the NLTK advisory.
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
- The strict Python audit still exits 1 for the single NLTK finding above.

JUnit, coverage, browser artifacts, the audit JSON and CI service logs are under
`.runtime/ci/`. The isolated CI stack and test volume were cleaned up; the
developer app remains available at `http://localhost:3000/`.
These are local results; the changed workflow has not been run on GitHub yet.
Optional directory publication and legacy non-travel integrations are not claimed
as tested by the travel regression suite.
