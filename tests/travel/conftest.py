"""Existing graph tests are credential-free; security tests opt into enforcement."""

import os

os.environ["TRAVEL_SECURITY_ENABLED"] = "false"
