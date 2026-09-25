"""Run the full Python audit, then apply exact, expiring advisory exceptions.

The raw scanner report is never filtered. Scanner errors, incomplete reports,
new findings, patched findings, and invalid/expired policies fail closed.
"""

import argparse
import json
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name


def expected_packages(requirements):
    expected = {}
    for line in requirements.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        requirement = Requirement(line)
        if requirement.marker and not requirement.marker.evaluate():
            continue
        pins = list(requirement.specifier)
        if requirement.url or len(pins) != 1 or pins[0].operator != "==" or "*" in pins[0].version:
            raise ValueError(f"Audit requires an exact version: {requirement.name}")
        name = canonicalize_name(requirement.name)
        if name in expected:
            raise ValueError(f"Duplicate requirement: {name}")
        expected[name] = pins[0].version
    if not expected:
        raise ValueError("Empty dependency export")
    return expected


def evaluate(report, exceptions, expected, scanner_code, today):
    if scanner_code not in (0, 1):
        raise ValueError(f"Scanner failed with exit code {scanner_code}")
    if not isinstance(exceptions, list):
        raise ValueError("Exception policy must be a list")
    rules = {}
    for rule in exceptions:
        fields = ("package", "version", "advisory", "approved_on", "expires_on", "reason")
        if not isinstance(rule, dict) or any(not isinstance(rule.get(key), str) or not rule[key].strip() for key in fields):
            raise ValueError("Invalid exception policy entry")
        approved = date.fromisoformat(rule["approved_on"])
        expires = date.fromisoformat(rule["expires_on"])
        if not (0 < (expires - approved).days <= 14 and approved <= today < expires):
            raise ValueError(f"Exception is expired, future-dated, or exceeds 14 days: {rule['advisory']}")
        key = (canonicalize_name(rule["package"]), rule["version"], rule["advisory"])
        if key in rules:
            raise ValueError("Duplicate exception")
        rules[key] = rule

    if not isinstance(report, dict) or not isinstance(report.get("dependencies"), list):
        raise ValueError("Invalid scanner report")
    seen, accepted, blocked, used = {}, [], [], set()
    findings = 0
    for dependency in report["dependencies"]:
        if not isinstance(dependency, dict) or dependency.get("skip_reason"):
            raise ValueError("Scanner skipped a dependency")
        if not all(isinstance(dependency.get(key), str) for key in ("name", "version")) or not isinstance(dependency.get("vulns"), list):
            raise ValueError("Invalid dependency result")
        name, version = canonicalize_name(dependency["name"]), dependency["version"]
        if name in seen:
            raise ValueError(f"Duplicate scanner result: {name}")
        seen[name] = version
        for vulnerability in dependency["vulns"]:
            if not isinstance(vulnerability, dict) or not isinstance(vulnerability.get("id"), str) or not isinstance(vulnerability.get("fix_versions"), list):
                raise ValueError("Invalid vulnerability result")
            findings += 1
            advisory = vulnerability["id"]
            key = (name, version, advisory)
            finding = {"package": name, "version": version, "advisory": advisory}
            if key in rules and not vulnerability["fix_versions"]:
                used.add(key)
                accepted.append({**finding, "expires_on": rules[key]["expires_on"], "reason": rules[key]["reason"]})
            else:
                blocked.append({**finding, "fix_versions": vulnerability["fix_versions"]})
    if seen != expected:
        raise ValueError("Scanner report does not cover the complete exported dependency set")
    if scanner_code != int(findings > 0):
        raise ValueError("Scanner exit code disagrees with its report")
    # Remove obsolete exceptions when upgrading or when an advisory is withdrawn.
    unused = set(rules) - used
    if unused and not blocked:
        raise ValueError("Unused exception: remove it and rerun the audit")
    return {"status": "failed" if blocked else "passed_with_exception" if accepted else "passed", "accepted": accepted, "blocked": blocked}


def run(requirements, policy, report_path, decision_path):
    # Never accept a previous run's report if the scanner fails before writing.
    report_path.unlink(missing_ok=True)
    decision_path.unlink(missing_ok=True)
    try:
        expected = expected_packages(requirements.read_text())
        exceptions = json.loads(policy.read_text())
        result = subprocess.run([
            sys.executable, "-m", "pip_audit", "-r", str(requirements),
            "--no-deps", "--disable-pip", "--format", "json", "-o", str(report_path),
        ], check=False)
        decision = evaluate(
            json.loads(report_path.read_text()), exceptions, expected, result.returncode,
            datetime.now(timezone.utc).date(),
        )
    except (OSError, ValueError) as error:
        decision = {"status": "failed", "error": str(error), "accepted": [], "blocked": []}
    decision_path.write_text(json.dumps(decision, indent=2) + "\n")
    for finding in decision["accepted"]:
        print(f"::warning::Temporary audit exception: {finding['package']}=={finding['version']} "
              f"{finding['advisory']}; expires {finding['expires_on']} UTC. Finding retained in raw report.")
    print(json.dumps(decision, indent=2))
    return int(decision["status"] == "failed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--requirements", type=Path, required=True)
    parser.add_argument("--policy", type=Path, default=Path("scripts/ci/audit_exceptions.json"))
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--decision", type=Path, required=True)
    args = parser.parse_args()
    sys.exit(run(args.requirements, args.policy, args.report, args.decision))
