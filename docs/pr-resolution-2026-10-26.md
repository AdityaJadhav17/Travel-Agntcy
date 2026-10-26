# Four dependency PRs, 2026-10-26

## Review and included changes

Four PRs were open when inspected. Each changes only the frontend package
manifest and lockfile. None has merge conflicts, submitted reviews or inline
review comments. Include their updates together on current main:

| PR | Update | Observed GitHub CI |
| --- | --- | --- |
| [#39](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/39) | TypeScript ESLint parser/plugin and related packages 8.71.2 → 8.72.0 | [Passed](https://github.com/AdityaJadhav17/Travel-Agntcy/actions/runs/40385015020) at `86b9c5fcfe035583d57aa3bbf3728139d00b4996`. |
| [#41](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/41) | Node types 24.10.9 → 26.6.5, with matching undici-types | [Older run failed](https://github.com/AdityaJadhav17/Travel-Agntcy/actions/runs/39978119934) only the Python dependency audit and aggregate gate. Frontend, browser, Python tests and infrastructure jobs passed. |
| [#42](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/42) | Vite 8.3.4 → 8.3.5 | [Passed](https://github.com/AdityaJadhav17/Travel-Agntcy/actions/runs/40384998741) at `984485b5edb2cd248d780ebdeec6ba88a003cf49`. |
| [#43](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/43) | lucide-react 1.59.0 → 1.61.0 | [Passed](https://github.com/AdityaJadhav17/Travel-Agntcy/actions/runs/40385054787) at `ff325765c014865d1f77a5ed943b5c654828b4ac`. |

PR #41's head is `32229adbc01f1160164fdb5a217e6a8ebd802755`, based on main before
the Python fixes. Its failed audit is unrelated to the Node types update.
Current main at `4dca69f3a89fcbf74a414da0652d8730ab0a726d` includes those fixes
and has [passing CI](https://github.com/AdityaJadhav17/Travel-Agntcy/actions/runs/40384802169).
The combined branch retains the patched Python lock and empty exception policy.

The combined npm lock changes only the requested packages, the matching
TypeScript ESLint package family, and undici-types required by the Node types.
The TypeScript 7 compiler / TypeScript 6 compatibility alias setup remains valid.
No application source changes are needed for these updates.

## Local validation

- Clean native `npm ci`, complete peer dependency verification, lint with zero
  warnings, formatting, TypeScript and production build pass. The Linux CI
  container also passes all frontend checks; the production UI image builds.
- Native and Linux npm audits report zero vulnerabilities. A fresh complete
  Python audit on the combined branch also passes without exceptions.
- All 14 updated package entries retain the versions, registry URLs and
  integrity hashes from the original PRs. The regenerated plugin parser peer
  range matches the installed package's manifest; both root parser and plugin
  dependencies remain pinned to 8.72.0.
- All 30 Chromium and Firefox journeys pass. Conversation persistence survives
  an API restart, and the deterministic fixture evaluation passes 10/10
  scenarios with zero failed checks or incorrect assumptions. This evaluation
  does not measure live-model accuracy or real provider cost.
- Source hygiene, the Playwright version guard and whitespace checks pass.

Logs are under `.runtime/oct26-pr-*`, with container reports under
`.runtime/ci/oct26-pr-*`. Docker initially encountered an invalid local cached
snapshot when exporting the Python CI image. Rebuilding without cached layers
succeeded; no repository change was needed for that local cache issue.
The isolated `travel-ci` containers and their test volume are cleaned up after
validation.

## Publish and resolve

Changes are uncommitted on `codex/pr-resolution-oct26`, based on main at
`4dca69f3a89fcbf74a414da0652d8730ab0a726d`. No remote PR was modified, merged or
closed, following the maintainer's preference to commit and push personally.

Review and commit the manifest, lockfile and this report, then publish:

```powershell
git push -u origin codex/pr-resolution-oct26
```

Open a combined PR and require a fresh passing GitHub CI run. After it is
merged, close #39, #41, #42 and #43 as superseded. Alternatively, rebase #41 onto
current main and merge the original PRs individually after their checks pass;
do not also merge the combined dependency update in that case.
