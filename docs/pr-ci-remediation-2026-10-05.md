# PR and CI remediation, 2026-10-05

## Shared CI failures

The scheduled [main run](https://github.com/AdityaJadhav17/Travel-Agntcy/actions/runs/37346548333)
passed Python tests, browser journeys, infrastructure checks and production image
builds. Both dependency audits failed, so the aggregate quality gate failed too.

- The locked `PyJWT==2.13.0` now reports 13 advisories. Upgrade to `2.15.1` and
  require that patched minimum in `pyproject.toml`. The lock resolver also updates
  optional `spiffe` to `0.3.2`, whose constraints permit the patched PyJWT.
- The frontend audit reports six affected packages through `braces==3.0.3`,
  [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
  There is no patched braces release. Tailwind 3 depends on that package through
  its globbing/watch tooling. Migrate to Tailwind 4.3.3 and its PostCSS plugin,
  following the [official migration guide](https://tailwindcss.com/docs/upgrade-guide).
  Move the theme and animations into CSS, migrate renamed utilities, and configure
  Prettier's Tailwind plugin to read the CSS stylesheet. Inline theme variables
  preserve colors that change on `body[data-theme="light"]`. Remove the now-unused
  Autoprefixer dependency because Tailwind 4 handles prefixing itself.
- The only remaining Python finding is the existing, maintainer-approved NLTK
  exception. It still expires **2026-10-09 at 00:00 UTC**, without renewal. No audit
  thresholds, coverage requirements or exception validation have been weakened.

Older frontend PR runs also failed when collecting service logs, after their
browser steps passed. Those branches predate the report-directory ownership fix
already on main. Updating them with the repaired base includes that fix.

## Open PR review

| PR | Update | Required treatment |
| --- | --- | --- |
| [#1](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/1) | Python 3.14 slim images | Investigate native dependency build before accepting. `agntcy-app-sdk==0.4.6` pins `slim-bindings==0.6.3`, which has no CPython 3.14 wheel. The current slim image falls back to source compilation and fails because the C linker is absent. |
| [#2](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/2) | upload-artifact 7.0.1 | Include the shared CI fix and validate the pinned action update. |
| [#3](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/3) | checkout 7.0.1 | Include the shared CI fix and validate the pinned action update. |
| [#6](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/6) | React Flow 12.11.6 | Include the shared fix, resolve the lockfile against Tailwind 4 and verify browser journeys. |
| [#7](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/7) | Radix Select 2.3.7 | Include the shared fix, resolve the lockfile and verify browser journeys. |
| [#8](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/8) | Autoprefixer 10.6.1 | Superseded by removing Autoprefixer in the Tailwind 4 migration. |
| [#9](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/9) | Lucide React 1.47.0 | Include the shared fix and verify TypeScript, build and browser journeys for this major update. |
| [#10](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/10) | Prettier 3.9.8 | Include the shared fix and verify formatting with the updated Tailwind plugin. |
| [#11](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/11) | nginx 1.31 alpine | Include the shared fix and verify UI serving and browser journeys. |
| [#12](https://github.com/AdityaJadhav17/Travel-Agntcy/pull/12) | Node 26 alpine | Include the shared fix and verify frontend checks and UI image builds. |

## Publication

This workspace initially had no authenticated GitHub CLI or connector session.
Public API reads and branch fetches work, but updating PR heads, publishing the
shared fix and merging or closing PRs require GitHub authentication. Local
validation does not establish that a new GitHub Actions run has passed.
