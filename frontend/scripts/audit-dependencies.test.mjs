import assert from "node:assert/strict"
import test from "node:test"
import { acceptsDevFinding } from "./audit-dependencies.mjs"

test("the temporary audit exception applies only to the pinned dev advisory", () => {
  const picomatch = "node_modules/picomatch"
  const vite = "node_modules/vite"
  const packages = {
    [picomatch]: { version: "4.0.7", dev: true },
    [vite]: { dev: true },
  }
  const report = {
    vulnerabilities: {
      picomatch: {
        nodes: [picomatch],
        via: [
          {
            name: "picomatch",
            url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf",
          },
        ],
      },
      vite: { nodes: [vite], via: ["picomatch"] },
    },
  }
  assert.equal(acceptsDevFinding(report, packages, "2026-11-17"), true)
  assert.equal(acceptsDevFinding(report, packages, "2026-11-24"), false)
  assert.equal(
    acceptsDevFinding(
      report,
      { ...packages, [picomatch]: { version: "4.0.7" } },
      "2026-11-17",
    ),
    false,
  )
  assert.equal(
    acceptsDevFinding(
      report,
      { ...packages, [picomatch]: { version: "4.0.6", dev: true } },
      "2026-11-17",
    ),
    false,
  )
  report.vulnerabilities.vite.via.push({
    name: "vite",
    url: "https://example.test/new-advisory",
  })
  assert.equal(acceptsDevFinding(report, packages, "2026-11-17"), false)
})
