# Copyright AGNTCY Contributors (https://github.com/agntcy)
# SPDX-License-Identifier: Apache-2.0

"""
Application Configuration

Central configuration module that loads settings from environment variables.
All configuration values are loaded at module import time from .env files.

Key sections:
- Transport: Message transport settings (NATS/SLIM)
- LLM: Language model configuration
- SerpAPI: Travel search API settings
- Identity: Authentication settings
"""

import os
from dotenv import load_dotenv

load_dotenv()  # Automatically loads from `.env` or `.env.local`

# =============================================================================
# Transport Configuration
# =============================================================================
# Message transport for agent communication (NATS or SLIM)
DEFAULT_MESSAGE_TRANSPORT = os.getenv("DEFAULT_MESSAGE_TRANSPORT", "NATS")
TRANSPORT_SERVER_ENDPOINT = os.getenv("TRANSPORT_SERVER_ENDPOINT", "nats://localhost:4222")

# =============================================================================
# LLM Configuration
# =============================================================================
# Language model settings - uses litellm for provider abstraction
LLM_MODEL = os.getenv("LLM_MODEL", "")
LLM_INTENT_MODEL = os.getenv("LLM_INTENT_MODEL", "")
LLM_EXTRACTION_MODEL = os.getenv("LLM_EXTRACTION_MODEL", "")
LLM_REFLECTION_MODEL = os.getenv("LLM_REFLECTION_MODEL", "")
LLM_REASONING_EFFORT = os.getenv("LLM_REASONING_EFFORT", "low")

# OAuth2 OpenAI Provider (optional)
OAUTH2_CLIENT_ID = os.getenv("OAUTH2_CLIENT_ID", "")
OAUTH2_CLIENT_SECRET = os.getenv("OAUTH2_CLIENT_SECRET", "")
OAUTH2_TOKEN_URL = os.getenv("OAUTH2_TOKEN_URL", "")
OAUTH2_BASE_URL = os.getenv("OAUTH2_BASE_URL", "")
OAUTH2_APPKEY = os.getenv("OAUTH2_APPKEY", "")

# =============================================================================
# SerpAPI Configuration (Travel Agent)
# =============================================================================
# SerpAPI is used to search for flights and hotels
# Get your API key at: https://serpapi.com/
SERPAPI_API_KEY = os.getenv("SERPAPI_API_KEY", "")
SERPAPI_BASE_URL = os.getenv("SERPAPI_BASE_URL", "https://serpapi.com/search")

# Minimum hours required between flight arrival and hotel check-in
# This buffer accounts for: deplaning, customs, baggage, airport-to-hotel travel
# Default: 2 hours - adjust based on your use case
TRAVEL_HOTEL_CHECKIN_GAP_HOURS = int(os.getenv("TRAVEL_HOTEL_CHECKIN_GAP_HOURS", "2"))

# =============================================================================
# Logging Configuration
# =============================================================================
LOGGING_LEVEL = os.getenv("LOGGING_LEVEL", "INFO").upper()
TRACING_ENABLED = os.getenv("TRACING_ENABLED", "false").lower() == "true"

# =============================================================================
# HTTP Server Configuration
# =============================================================================
ENABLE_HTTP = os.getenv("ENABLE_HTTP", "true").lower() in ("true", "1", "yes")

# Explicit browser origins for the local UI or a configured deployment.
TRAVEL_ALLOWED_ORIGINS = tuple(
    origin.strip() for origin in os.getenv(
        "TRAVEL_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",") if origin.strip()
)
if "*" in TRAVEL_ALLOWED_ORIGINS:
    raise ValueError("TRAVEL_ALLOWED_ORIGINS must list explicit origins")
