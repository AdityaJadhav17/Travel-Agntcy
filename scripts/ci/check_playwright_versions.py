"""Fail before building when Playwright's package and browser image differ."""

import json
import re
from pathlib import Path


def check(root):
    package = json.loads((root / "frontend/package.json").read_text())
    version = package["devDependencies"]["@playwright/test"]
    dockerfile = (root / "docker/Dockerfile.e2e").read_text()
    match = re.search(r"^FROM mcr\.microsoft\.com/playwright:v(\d+\.\d+\.\d+)-", dockerfile, re.MULTILINE)
    if not match or version != match[1]:
        raise SystemExit(
            "Pin @playwright/test and docker/Dockerfile.e2e to the same exact version; "
            f"package={version}, image={match[1] if match else 'unrecognized'}."
        )
    print(f"Playwright package and browser image match: {version}")


if __name__ == "__main__":
    check(Path(__file__).resolve().parents[2])
