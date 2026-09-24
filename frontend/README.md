# Travel Agntcy frontend

React 19, TypeScript, Vite 6. Use Node.js 22 and npm.

From this directory: `npm ci`, then `npm run dev` (http://localhost:3000).
Checks: `npm run check` (lint with zero warnings, format, types, build).
Use `npm run format` and `npm run lint` to fix style findings.
Do not commit node_modules or dist; install with `npm ci`.
For Docker-only checks, use the frontend-tools commands in the root README.
Copy `.env.example` to `.env` only if you need to override the local API URL.
The UI sends POST /agent/prompt to VITE_EXCHANGE_APP_API_URL (default port 8000).
See the root README for the recommended Docker setup and backend requirements.
