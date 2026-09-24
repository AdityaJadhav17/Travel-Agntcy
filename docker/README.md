# Docker setup

See the root README for the complete Travel Agntcy startup instructions.
From the repository root: `docker compose build`, then `docker compose up -d --wait`.
The core stack contains NATS, three A2A search agents, the supervisor, and nginx UI.
Backend Dockerfiles install uv.lock dependencies before copying/installing the source.
The UI build uses Node 22 and npm ci; VITE values are build arguments.
Optional infrastructure uses Compose profiles documented in the root README.
