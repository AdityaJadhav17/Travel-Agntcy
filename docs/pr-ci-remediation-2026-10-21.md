# CI and TypeScript PR remediation, 2026-10-21

## Latest failure

The [latest main CI run](https://github.com/AdityaJadhav17/Travel-Agntcy/actions/runs/39677242642)
at `724958894b42a3a2238a93ca4562f7fa0cf5368d` failed the Python dependency audit
and its aggregate quality gate. Frontend checks, Python tests, browser journeys,
restart persistence and infrastructure checks passed remotely.

Reproducing the complete audit against that lockfile found 29 blocked findings:
24 in Pillow 12.3.0 and five in pypdf 6.19.0. Upgrade the locked versions to
Pillow 13.0.0 and pypdf 6.21.2. Add the patched Pillow minimum and raise the
pypdf minimum to 6.21.1 so a future resolution cannot select an affected release.
The scoped lock update changes only these two packages.

The raw reports are `.runtime/oct21-python-audit-before.json` and
`.runtime/oct21-python-audit-after.json`. The complete post-fix audit passes
with zero blocked findings. The existing exact NLTK 3.10.3 / PYSEC-2026-3740
exception is unchanged and expires **October 26, 2026 at 00:00 UTC**. The finding
remains visible; no scanner scope, expiry enforcement or quality gate was
weakened, and no automatic renewal was made.

## Open PR #33

Only [PR #33](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/33) was open
when inspected. Its direct TypeScript 5.9.3 to 7.0.2 replacement fails frontend
installation because `@typescript-eslint/parser` and its plugin require
TypeScript `<6.1.0`. Even the latest published parser 8.72.0 retains that range.
TypeScript 7.0 also does not expose the legacy compiler API used by ESLint.

Include TypeScript 7.0.2 using
[Microsoft's documented side-by-side setup](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0):

- `@typescript/native` aliases `typescript@^7.0.2` and supplies `tsc` for the
  application and E2E type checks.
- `typescript` aliases `@typescript/typescript6@^6.0.2`, supplying the supported
  compiler API to ESLint. This compatibility package reports compiler version
  6.0.3 and supplies the distinct `tsc6` executable.
- Remove obsolete `baseUrl` and express the existing `@/*` mapping relative to
  the configuration as `./src/*`. The alias still resolves to the same source.
- Group the compiler aliases and TypeScript ESLint packages in Dependabot.

No force installation, legacy-peer-deps, disabled lint rules or type-check
suppression is needed. Clean installation and `npm ls --all` succeed. The
native Windows and Linux CI checks confirm that `tsc` runs version 7.0.2 and
ESLint uses the compatibility API. The upstream
[TypeScript ESLint discussion](https://github.com/typescript-eslint/typescript-eslint/issues/12518)
explains why the compatibility package is needed. Revisit it when the parser
supports the native compiler API.

## Validation and handoff

- Clean frontend installation, peer dependency verification, lint with zero
  warnings, formatting, TypeScript 7 checks and production build pass on
  Windows and in the Linux CI container. npm audit reports zero vulnerabilities.
- Ruff and 162 Python tests pass on Windows and Linux with 96.57%
  branch-inclusive targeted coverage against the unchanged 90% requirement.
  Full Python audits pass in both environments with only the existing exception.
- Production UI and all four production Python images build successfully.
  Workflow lint, both Helm chart lints and the redacted source credential scan
  pass. Source hygiene and the Playwright version guard also pass.
- All 30 Chromium and Firefox journeys pass. Conversation persistence passes
  across an API restart, and the deterministic fixture evaluation passes 10/10
  scenarios with zero failed checks or incorrect assumptions. This evaluation
  does not measure live-model accuracy or real provider cost.

Logs are under `.runtime/oct21-*`; Linux audit, JUnit and coverage artifacts are
under `.runtime/ci/oct21-*`. These are local CI reproductions; GitHub has not run
the uncommitted changes. The isolated `travel-ci` containers and test volume are
removed after validation.

Changes are left **uncommitted** on `codex/ci-pr-remediation-oct21`, based on the
main commit above, following the maintainer's instruction to commit and push
personally. No remote PR branch has been modified, merged or closed. Commit and
push this branch, open a combined fix PR, and require a fresh successful GitHub
CI run. Once merged, #33 can be closed as superseded by the compatible update.

```powershell
git push -u origin codex/ci-pr-remediation-oct21
```
