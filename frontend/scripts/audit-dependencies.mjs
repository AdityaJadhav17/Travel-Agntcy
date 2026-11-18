import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"

const advisory = {
  package: "picomatch",
  version: "4.0.7",
  url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf",
  expires: "2026-11-24",
}

// npm reports the same advisory against every transitive dependent. Walk those
// links to the advisory, checking that every affected installation is dev-only.
export function acceptsDevFinding(report, packages, today) {
  const findings = report.vulnerabilities
  if (!findings || report.error || today >= advisory.expires) return false
  const root = findings[advisory.package]
  if (!root || !Object.keys(findings).length) return false

  function covered(name, ancestors = new Set()) {
    if (ancestors.has(name)) return false
    const entry = findings[name]
    if (!entry || !entry.nodes?.length || !entry.via?.length) return false
    if (!entry.nodes.every((node) => packages[node]?.dev === true)) return false
    if (name === advisory.package) {
      return (
        entry.nodes.every(
          (node) => packages[node]?.version === advisory.version,
        ) &&
        entry.via.every(
          (item) =>
            item?.name === advisory.package && item.url === advisory.url,
        )
      )
    }
    const path = new Set(ancestors).add(name)
    return entry.via.every(
      (item) => typeof item === "string" && covered(item, path),
    )
  }

  return Object.keys(findings).every((name) => covered(name))
}

if (process.argv[2]) {
  const output = process.argv[2]
  const npm = spawnSync("npm", ["audit", "--audit-level=low", "--json"], {
    encoding: "utf8",
  })
  writeFileSync(output, npm.stdout ?? "")
  if (npm.stderr) process.stderr.write(npm.stderr)
  try {
    const report = JSON.parse(npm.stdout)
    const findings = report.vulnerabilities
    if (
      npm.error ||
      report.error ||
      report.auditReportVersion !== 2 ||
      !findings ||
      typeof findings !== "object" ||
      Array.isArray(findings) ||
      report.metadata?.vulnerabilities?.total !== Object.keys(findings).length
    ) {
      throw new Error("npm audit did not return a complete report")
    }
    if (npm.status === 0 && Object.keys(findings).length === 0) {
      console.log("npm audit passed")
    } else if (
      npm.status === 1 &&
      acceptsDevFinding(
        report,
        JSON.parse(readFileSync("package-lock.json", "utf8")).packages,
        new Date().toISOString().slice(0, 10),
      )
    ) {
      console.log(
        `::warning::Unpatched dev-only ${advisory.package}@${advisory.version} advisory accepted through ${advisory.expires} UTC (exclusive). Full npm audit report retained.`,
      )
    } else {
      throw new Error(
        "npm audit found a vulnerability outside the temporary policy",
      )
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
