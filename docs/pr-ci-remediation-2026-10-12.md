# CI and six dependency PRs, 2026-10-12

## Causes

The latest scheduled [main CI run](https://github.com/AdityaJadhav17/Travel-Agntcy/actions/runs/38287907229)
passed application tests, browser journeys and production builds, but failed both
dependency audits. The aggregate quality gate therefore failed too.

- `source-map-js==1.2.1` is affected by
  [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
  Update the compatible transitive dependency to its patched 1.2.2 release.
- The exact NLTK exception expired on October 9. The maintainer explicitly
  reapproved it on October 12 for 14 days, ending **October 26 at 00:00 UTC**.
  NLTK remains unpatched upstream; the finding stays in the complete raw audit
  report. The scanner, exception validation, coverage threshold and quality gate
  are unchanged.
- PR #19 updated the Playwright image without updating the pinned test package.
  The [official Docker guidance](https://playwright.dev/docs/docker) requires
  matching versions so Playwright can find its browser binaries. Both now use
  1.64.0. A check before the E2E build reports a clear error if they diverge again.
- PR #20 updated `@eslint/js` to 10 while ESLint and its plugins remained on
  incompatible versions. Upgrade ESLint to 10.0.1, both TypeScript ESLint packages
  to 8.71.2 and React Refresh's plugin to 0.5.7; a clean install and `npm ls` verify
  peer compatibility. The new error-preservation rule is satisfied by attaching
  the original API error as `cause`, with ES2022 library types for `ErrorOptions`.
- PR #24 enables React Hooks 7's additional recommended checks. Fix the flagged
  source patterns without disabling rules: remove redundant pattern-reset
  effects already handled by the user event, report storage failures through a
  promise rejection callback while retaining synchronous writes, reset feed
  state with a component key, and derive detail-dialog loading state from the
  asynchronous request result. Closing a dialog disposes its request state;
  obsolete responses are ignored and the service's error message survives retries.

## PR updates included locally

| PR | Included update and compatibility fix |
| --- | --- |
| [#19](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/19) | Playwright image and exact `@playwright/test` pin both 1.64.0; early version-match check. |
| [#20](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/20) | `@eslint/js` 10.0.1, ESLint 10.0.1 and compatible TypeScript/Refresh plugins; preserve original API errors. |
| [#21](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/21) | `tailwind-merge` 3.7.0. |
| [#22](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/22) | `lucide-react` 1.52.0. |
| [#23](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/23) | React Flow 12.12.0. |
| [#24](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/24) | React Hooks plugin 7.1.1 and the source fixes above. |

## Validation

- Clean `npm ci`, peer dependency verification, lint with zero warnings,
  formatting, TypeScript and production build passed. The frontend container
  check passed on Node 26. npm audit reports zero vulnerabilities.
- Ruff and 162 Python tests passed with 96.57% branch-inclusive targeted coverage
  against the unchanged 90% requirement. The Python audit passes with only the
  specifically approved, visible NLTK exception and zero blocked findings.
- All 30 existing browser journeys passed with Playwright 1.64 across Chromium
  and Firefox. Additional focused checks exercised the actual badge/policy
  dialogs' error text, retries, reopening and stale-response isolation in both
  browsers, and verified that storage failure warnings do not stop chatting.
- Workflow lint, the Linux runner report-permissions regression, source hygiene,
  Helm chart lint and all five production image builds passed.
- Conversation persistence passed after restarting the isolated API, and the
  scored conversation evaluation passed 10/10 scenarios with zero failed checks
  or incorrect assumptions.

Logs are under `.runtime/oct12-*`, with full Python audit/coverage/JUnit artifacts
under `.runtime/ci/oct12-*`. The focused browser harness is temporary and ignored
under `.runtime/identity-harness`; it adds no production UI or dependencies.

## Commit and publish

Changes are left **uncommitted** on `codex/ci-pr-remediation-oct12`, based on
`origin/main` at `e2c080060debed86ab5be9ff372027f66f947939`. No remote PR has been
updated or merged. The changes include the requested versions from all six PRs;
their individual branches remain unchanged until a maintainer updates or
supersedes them.

Commit this branch and push it with:

```powershell
git push -u origin codex/ci-pr-remediation-oct12
```

Require a fresh successful GitHub CI run before merging. Once the combined fix
is merged, the six original dependency PRs can be closed as superseded.
