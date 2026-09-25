"""Reproduce Linux runner ownership, then verify preparation before Docker writes.

Run as root in a disposable Linux container with this directory at /scripts.
Temporary files are private to the container; no checkout ownership is changed.
"""

import os
import subprocess
import tempfile
from pathlib import Path


with tempfile.TemporaryDirectory() as temp:
    base = Path(temp)
    os.chmod(base, 0o755)
    for name in ("before", "after"):
        folder = base / name
        folder.mkdir()
        os.chown(folder, 1001, 1001)

    os.chdir(base / "before")
    Path(".runtime/ci/playwright").mkdir(parents=True)
    os.seteuid(1001)
    try:
        Path(".runtime/ci/services.log").write_text("logs")
        raise AssertionError("Expected Docker-created parent to deny runner writes")
    except PermissionError:
        print("Reproduced original permission denial.")
    finally:
        os.seteuid(0)

    os.chdir(base / "after")
    # Set both real and effective UID; shells reset an effective-only UID change.
    subprocess.run(["sh", "/scripts/prepare_reports.sh"], user=1001, group=1001, check=True)
    assert Path(".runtime/ci").stat().st_uid == 1001
    Path(".runtime/ci/playwright/junit.xml").write_text("<testsuites/>")
    os.seteuid(1001)
    try:
        Path(".runtime/ci/services.log").write_text("logs")
        assert Path(".runtime/ci/playwright/junit.xml").read_text() == "<testsuites/>"
        print("Runner log collection and report reading passed after preparation.")
    finally:
        os.seteuid(0)
        os.chdir("/")
