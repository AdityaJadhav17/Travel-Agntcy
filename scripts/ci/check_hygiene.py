"""Reject generated assets and credential files in the Git index."""

import subprocess
from pathlib import PurePosixPath

files = subprocess.check_output(["git", "ls-files", "-z"]).decode().split("\0")
blocked = []
for name in filter(None, files):
    path = PurePosixPath(name)
    if (
        any(part in {"node_modules", ".venv", ".runtime", "__pycache__", "playwright-report", "test-results"} for part in path.parts)
        or (path.name.startswith(".env") and path.name != ".env.example")
        or ".sqlite3" in path.name
        or name.startswith("frontend/dist/")
    ):
        blocked.append(name)
if blocked:
    raise SystemExit("Remove generated or sensitive files from Git:\n" + "\n".join(blocked[:30]))
print("Git index hygiene passed.")
