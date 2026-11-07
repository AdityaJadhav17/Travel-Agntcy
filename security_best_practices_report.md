# PR and security remediation, 2026-11-07

The combined branch addresses all six open dependency PRs, fixes both dependency
audit failures, and hardens the development stack's network defaults. The
previously embedded Identity API key was removed from current source. Revoke and
rotate it if it is still active, since it remains in Git history.

## PR resolution

All six PRs were mergeable with no submitted reviews or inline comments when
checked. The [main CI run](https://github.com/AdityaJadhav17/Travel-Agntcy/actions/runs/41500846602)
failed both dependency audits. The individual PR runs also failed one or both
audits; #48 additionally failed the Playwright package/image version guard.

| PR | Included update |
| --- | --- |
| [#44](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/44) | TypeScript ESLint parser and plugin 8.72.1, with their matching dependencies. |
| [#45](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/45) | PostCSS 8.5.32. |
| [#47](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/47) | Axios 1.21.0. |
| [#48](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/48) | Playwright Docker image and exact test package both 1.65.0. |
| [#49](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/49) | Vite React plugin 6.2.1, with the current Vite 8 and TypeScript compatibility setup. |
| [#50](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/50) | Lucide React's requested `^1.67.0` range, resolved to 1.70.0. |

## High priority

1. **Hard-coded Identity API key fallback (credential exposure).**
   The previous `config/config.py:74` embedded an API key fallback in source.
   It was unused by the application and has been removed. No request was sent
   using that key, so its current validity and permissions are unknown.
   If live, revoke it at the provider and issue a replacement through secret
   configuration. Removing a value from the current tree cannot revoke it.
2. **Unauthenticated development services published to all host interfaces.**
   The API accepts prompts and conversation deletions by UUID
   (`agents/supervisors/travel/main.py:150`, `:186`). The local Compose file
   published the API, agents, brokers and diagnostics without a host IP.
   A peer with network access could call services directly, consume provider
   quota, or access development infrastructure. All 21 host port bindings
   now use IPv4 loopback (`docker-compose.yaml:45`, `:151`, `:182` and
   subsequent port blocks). Native agent HTTP listeners also default to
   loopback; their production images explicitly listen inside the container.
3. **Vulnerable locked packages.**
   The Python audit found 14 advisories across LangGraph SDK, LiteLLM, msgpack,
   pyasn1, and pypdf. The patched lock uses 0.4.14, 1.102.2, 1.2.4, 0.6.5, and
   6.21.4, respectively. The npm audit also flagged
   [follow-redirects](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p)
   for credential forwarding; the lock now uses 1.16.2.

## Medium priority

4. **Wildcard browser access with credentials.**
   The API middleware at `agents/supervisors/travel/main.py:59` allowed all
   origins, methods, and headers with credentials enabled. Browser requests
   now use an explicit origin allowlist, only GET/POST/DELETE, and no
   cross-origin credentials. The default permits the local UI. Deployments
   with another browser origin set `TRAVEL_ALLOWED_ORIGINS`. The regression
   test checks both accepted local preflight and denied untrusted origins.
   See [FastAPI's CORS documentation](https://fastapi.tiangolo.com/tutorial/cors/).
5. **Lint tooling vulnerable to glob amplification.**
   [The minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)
   affects the version shared by ESLint and TypeScript ESLint. Their current
   published dependencies still request vulnerable major versions, so the
   manifest pins a temporary override to 11.0.1. Clean install, peer checks,
   and the full lint run verify the combination. Remove the override once
   all consumers depend on a patched version directly.

## Validation and deployment boundary

The dependency audits pass on Windows and Linux without ignored findings or
exception changes. Frontend lint, formatting, TypeScript, and build checks
pass on both. Ruff and 162 Python tests pass on Linux with 96.57% targeted
branch-inclusive coverage. All 30 Chromium and Firefox tests pass, and all
five production images build. The redacted current-source credential scan,
workflow and Helm lint, source hygiene, and Playwright version guard pass.
Conversations survive an API restart, and the deterministic evaluation passes
10/10 scenarios with zero failed checks.
Logs and reports are under `.runtime/nov07-*` and `.runtime/ci/nov07-*`.

This is a local-stack source and dependency review. CORS and loopback binding
do not provide user authentication or conversation ownership. A public
deployment needs both before exposing the travel API or broker. The audits
cover the Python runtime/CI and npm production/development dependency sets.
Optional Python extras, container OS packages, and live infrastructure were
outside this review.

Changes are uncommitted on `codex/pr-security-nov07`, based on main at
`a1a6e5f4ee9f6db99622217097b9b8da3b43e0c9`. Commit and push the combined
update, and verify GitHub CI before merging. The original six PRs remain open
and can be closed as superseded after the combined fix merges.
