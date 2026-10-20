# CI and dependency PR remediation, 2026-10-20

## Causes and fixes

The [main CI run](https://github.com/AdityaJadhav17/Travel-Agntcy/actions/runs/39486486814)
failed dependency audits. The locked frontend dependency `follow-redirects`
1.16.0 had two high findings (GHSA-q3jh-wrc6-jgq8 and GHSA-8r9p-f939-6h3c).
The Python lock had three aiohttp findings and one certifi finding. Upgrade
`follow-redirects` to 1.16.1, aiohttp to 3.14.5, and certifi to 2026.10.19.
Raise the Python minimums to the patched releases (aiohttp >=3.14.4 and
certifi >=2026.10.19) and retain the complete locked dependency audits.

Three dependency PRs were open when inspected. Their requested updates and
necessary compatibility changes are included together in this local branch:

| PR | Failure or compatibility issue | Included fix |
| --- | --- | --- |
| [#26](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/26) | Playwright image 1.64.1 differed from the exact 1.64.0 test package; the version guard rejected it. | Pin the package and browser image to 1.64.1. |
| [#28](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/28) | React and its types were updated independently of React DOM; dependency audits also failed. | Update React and React DOM to 19.3.1 and both type packages to 19.3.0. |
| [#29](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/29) | React plugin 6 requires Vite 8, but the project used Vite 6, blocking installation and builds. | Pair plugin-react 6.1.2 with Vite 8.3.4 and use `import.meta.dirname` in the ESM Vite configuration. |

Vite 8 changes its build toolchain to Rolldown/Oxc, so the regenerated npm lock
removes the previous Rollup/esbuild/Babel dependency graph where no longer
needed. See the [official Vite migration guide](https://vite.dev/guide/migration).
Dependabot now groups the React runtime/types and the Vite/plugin pair to reduce
future incompatible isolated updates, using the
[documented groups configuration](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).

The existing NLTK 3.10.3 exception remains unchanged: PYSEC-2026-3740 is retained
in the raw report, accepted only through **October 26, 2026 at 00:00 UTC** under
the maintainer's October 12 approval. No patched release was listed when
rechecked. No automatic renewal was made. Scanner scope, exception expiry
validation, the 90% coverage requirement and the quality gate remain unchanged.

## Validation

- Clean frontend installation, peer dependency verification, lint, formatting,
  TypeScript and production build passed natively and in the Linux CI container.
  Both frontend audits report zero vulnerabilities.
- Ruff and all 162 Python tests passed natively and in Linux, with 96.57%
  branch-inclusive targeted coverage. Full Python audits pass with only the
  existing NLTK exception and zero blocked findings.
- All 30 browser journeys passed in Chromium and Firefox with Playwright 1.64.1.
  Focused checks also passed for identity dialog errors, retries, reopening,
  obsolete responses and continued chatting after storage failures.
- Conversation persistence passed across an API restart. The deterministic
  fixture evaluation passed 10/10 scenarios with zero failed checks or incorrect
  assumptions; this does not measure live-model accuracy or real provider cost.
- Workflow lint, Linux report permission regression, source hygiene, both Helm
  chart lints and all five production image builds passed.
- Gitleaks 8.24.3 scanned a clean source snapshot containing the uncommitted
  fixes and report, with redacted output and no leaks found.

Logs are under `.runtime/oct20-*`; container audit, JUnit and coverage artifacts
are under `.runtime/ci/oct20-*`. The focused browser harness remains ignored
under `.runtime/identity-harness`.

Docker initially failed on stale local runtime sockets. The runtime directory
containing only those sockets was preserved as
`C:\Users\adity\AppData\Local\Docker\run-stale-20261020`. Docker then reported a
second inaccessible secrets-engine socket; no changes were made to that
directory. The maintainer subsequently started Docker, allowing container tests
to complete. The isolated `travel-ci` stack and its test volume are cleaned up
after validation.

## Publish and resolve the remote PRs

Changes are left **uncommitted** on `codex/ci-pr-remediation-oct20`, based on
`origin/main` at `ea077f096bf8b299cef6fe9f25dd48e69c403f6d`, following the
maintainer's instruction to commit and push personally. No remote PR branch was
modified, merged or closed. Review and commit the local changes, then push:

```powershell
git push -u origin codex/ci-pr-remediation-oct20
```

Open a combined PR and require a fresh successful GitHub CI run. After that PR
is merged, #26, #28 and #29 can be closed as superseded because this branch
includes their updates and the compatibility fixes.
