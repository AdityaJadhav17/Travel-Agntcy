"""Run a diagnostic command while masking configured secrets in its output."""
import os
import subprocess
import sys

from dotenv import dotenv_values

secrets = {
    value for key, value in {**dotenv_values(), **os.environ}.items()
    if value and len(value) > 5 and any(word in key.upper() for word in ("KEY", "TOKEN", "SECRET", "PASSWORD"))
}
result = subprocess.run(sys.argv[1:], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
output = result.stdout
for value in sorted(secrets, key=len, reverse=True):
    output = output.replace(value, "[REDACTED]")
sys.stdout.buffer.write(output.encode("utf-8"))
sys.exit(result.returncode)
