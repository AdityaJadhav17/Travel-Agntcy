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

# =============================================================================
# Identity Service Configuration
# =============================================================================
# This is for demo purposes only. In production, use secure methods to manage API keys.
IDENTITY_API_KEY = os.getenv("IDENTITY_API_KEY", "487>t:7:Ke5N[kZ[dOmDg2]0RQx))6k}bjARRN+afG3806h(4j6j[}]F5O)f[6PD")
IDENTITY_API_SERVER_URL = os.getenv("IDENTITY_API_SERVER_URL", "https://api.agent-identity.outshift.com")
