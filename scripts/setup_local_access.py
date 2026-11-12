"""Create a private local app unlock key without displaying credentials.

Run from any directory. Existing nonempty keys are preserved. This does not
modify provider credentials, billing, or network bindings.
"""

from pathlib import Path
import secrets
import re


def main():
    root = Path(__file__).resolve().parents[1]
    env = root / ".env"
    content = env.read_text(encoding="utf-8") if env.exists() else ""
    match = re.search(r"^TRAVEL_ACCESS_KEY=(.*)$", content, re.MULTILINE)
    key = match.group(1).strip().strip("\"'") if match else ""
    if not key:
        key = secrets.token_urlsafe(32)
        entry = f"TRAVEL_ACCESS_KEY={key}"
        content = re.sub(r"^TRAVEL_ACCESS_KEY=.*$", entry, content, flags=re.MULTILINE) if match else content.rstrip() + "\n" + entry + "\n"
        env.write_text(content, encoding="utf-8")
    private_file = root / ".runtime" / "local-access-key.txt"
    private_file.parent.mkdir(parents=True, exist_ok=True)
    private_file.write_text(key + "\n", encoding="utf-8")
    try:
        private_file.chmod(0o600)
        env.chmod(0o600)
    except OSError:
        pass
    print("Local app access key ready in .runtime/local-access-key.txt (not displayed).")


if __name__ == "__main__":
    main()
