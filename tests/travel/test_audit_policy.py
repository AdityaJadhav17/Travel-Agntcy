"""Security gate regressions: exceptions cannot hide unrelated or failed scans."""

import copy
import json
from datetime import date
from subprocess import CompletedProcess

import pytest

from scripts.ci.audit_policy import evaluate, expected_packages, run


TODAY = date(2026, 9, 25)
EXPECTED = {"nltk": "3.10.3"}
REPORT = {"dependencies": [{"name": "nltk", "version": "3.10.3", "vulns": [
    {"id": "PYSEC-2026-3740", "fix_versions": [], "aliases": ["CVE-2026-81726"]},
]}]}
RULE = {
    "package": "nltk", "version": "3.10.3", "advisory": "PYSEC-2026-3740",
    "approved_on": "2026-09-25", "expires_on": "2026-10-09",
    "reason": "Test fixture only; not an approved production exception.",
}


def test_empty_policy_blocks_the_real_finding():
    assert evaluate(REPORT, [], EXPECTED, 1, TODAY)["status"] == "failed"


def test_exact_unfixed_finding_is_visible_and_report_is_unchanged():
    report = copy.deepcopy(REPORT)
    decision = evaluate(report, [RULE], EXPECTED, 1, TODAY)
    assert decision["status"] == "passed_with_exception"
    assert decision["accepted"][0]["advisory"] == "PYSEC-2026-3740"
    assert decision["accepted"][0]["expires_on"] == "2026-10-09"
    assert report == REPORT


@pytest.mark.parametrize("today", [date(2026, 9, 24), date(2026, 10, 9), date(2026, 10, 10)])
def test_exception_has_a_hard_utc_date_window(today):
    with pytest.raises(ValueError, match="expired, future-dated"):
        evaluate(REPORT, [RULE], EXPECTED, 1, today)


@pytest.mark.parametrize("changes", [{"expires_on": "2026-10-10"}, {"reason": ""}, {"expires_on": "never"}])
def test_invalid_or_overlong_policy_fails(changes):
    with pytest.raises(ValueError):
        evaluate(REPORT, [{**RULE, **changes}], EXPECTED, 1, TODAY)


def test_another_advisory_blocks_even_with_same_alias():
    report = copy.deepcopy(REPORT)
    report["dependencies"][0]["vulns"].append({"id": "NEW-CVE", "aliases": ["PYSEC-2026-3740"], "fix_versions": []})
    decision = evaluate(report, [RULE], EXPECTED, 1, TODAY)
    assert decision["status"] == "failed"
    assert decision["blocked"][0]["advisory"] == "NEW-CVE"


def test_changed_version_is_not_excepted():
    report = copy.deepcopy(REPORT)
    report["dependencies"][0]["version"] = "3.10.4"
    assert evaluate(report, [RULE], {"nltk": "3.10.4"}, 1, TODAY)["status"] == "failed"


def test_another_package_cannot_use_the_exception():
    report = copy.deepcopy(REPORT)
    report["dependencies"][0]["name"] = "other-package"
    assert evaluate(report, [RULE], {"other-package": "3.10.3"}, 1, TODAY)["status"] == "failed"


def test_published_fix_disables_exception():
    report = copy.deepcopy(REPORT)
    report["dependencies"][0]["vulns"][0]["fix_versions"] = ["3.10.4"]
    assert evaluate(report, [RULE], EXPECTED, 1, TODAY)["status"] == "failed"


@pytest.mark.parametrize("report", [
    {}, {"dependencies": []},
    {"dependencies": [{"name": "nltk", "skip_reason": "could not audit"}]},
    {"dependencies": [{"name": "nltk", "version": "3.10.3"}]},
    {"dependencies": REPORT["dependencies"] * 2},
])
def test_incomplete_or_invalid_scan_never_passes(report):
    with pytest.raises(ValueError):
        evaluate(report, [RULE], EXPECTED, 1, TODAY)


@pytest.mark.parametrize("code", [0, 2, -1])
def test_scanner_failure_or_inconsistent_exit_is_fatal(code):
    with pytest.raises(ValueError):
        evaluate(REPORT, [RULE], EXPECTED, code, TODAY)


def test_clean_scan_and_obsolete_exception():
    report = {"dependencies": [{"name": "nltk", "version": "3.10.3", "vulns": []}]}
    assert evaluate(report, [], EXPECTED, 0, TODAY)["status"] == "passed"
    with pytest.raises(ValueError, match="Unused exception"):
        evaluate(report, [RULE], EXPECTED, 0, TODAY)


def test_export_markers_and_name_normalization():
    assert expected_packages('# comment\nNLTK==3.10.3\nmy_pkg==1.0\nignored==1; python_version < "2"') == {
        "nltk": "3.10.3", "my-pkg": "1.0",
    }


@pytest.mark.parametrize("requirements", ["", "nltk>=3", "nltk==3.*", "nltk==3\nnltk==4", "nltk @ https://example.com/nltk.whl"])
def test_export_must_be_exact_and_nonempty(requirements):
    with pytest.raises(ValueError):
        expected_packages(requirements)


def test_failed_scanner_cannot_reuse_stale_report(tmp_path, monkeypatch):
    requirements, policy, report, decision = [tmp_path / name for name in ("requirements.txt", "policy.json", "report.json", "decision.json")]
    requirements.write_text("nltk==3.10.3\n")
    policy.write_text("[]")
    report.write_text(json.dumps(REPORT))
    decision.write_text('{"status": "passed"}')
    monkeypatch.setattr("scripts.ci.audit_policy.subprocess.run", lambda *args, **kwargs: CompletedProcess([], 1))
    assert run(requirements, policy, report, decision) == 1
    assert not report.exists()
    assert json.loads(decision.read_text())["status"] == "failed"


def test_runner_retains_raw_report_and_returns_nonzero_for_findings(tmp_path, monkeypatch):
    requirements, policy, report, decision = [tmp_path / name for name in ("requirements.txt", "policy.json", "report.json", "decision.json")]
    requirements.write_text("nltk==3.10.3\n")
    policy.write_text("[]")

    def scan(command, **kwargs):
        assert "--ignore-vuln" not in command
        report.write_text(json.dumps(REPORT))
        return CompletedProcess(command, 1)

    monkeypatch.setattr("scripts.ci.audit_policy.subprocess.run", scan)
    assert run(requirements, policy, report, decision) == 1
    assert json.loads(report.read_text()) == REPORT
    assert json.loads(decision.read_text())["blocked"][0]["package"] == "nltk"
