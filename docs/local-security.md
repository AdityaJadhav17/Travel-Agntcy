# Private local app protection

This setup is for one trusted owner on one machine. It is not a public multi-user
account system. All existing local conversations belong to that owner.

## Unlocking the app

Run `python scripts/setup_local_access.py`, then rebuild/start Docker Compose.
The script preserves an existing key and stores the app unlock key in `.env`
and `.runtime/local-access-key.txt`. Both are ignored by Git and Docker builds.
Open that local file and paste its contents into the app's unlock form. Do not
paste an OpenAI or SerpAPI key into the form. The script never prints secrets.

The browser receives an HttpOnly, SameSite=Lax, eight-hour session cookie. The
unlock key is not stored in browser localStorage, sessionStorage or the frontend
bundle. The `/api` same-origin proxy avoids cross-site cookie problems between
localhost and 127.0.0.1. Local HTTP uses a non-Secure cookie; HTTPS deployments
must set `TRAVEL_COOKIE_SECURE=true` and review the whole deployment first.

Signing out clears the browser cookie. Rotate the app unlock key and restart the
supervisor to invalidate all previously issued cookies and bearer credentials.
This single-owner design does not provide individual device/session revocation.

## Default protections

- Authentication before paid prompt endpoints and conversation deletion.
- Explicit origin checks on cookie-authenticated modifying requests.
- At most 10 accepted prompt attempts per minute, 100 per UTC day, and 2 active
  prompts/streams per supervisor process. Daily accounting persists in SQLite.
- Bounded login attempts and request body size.
- `TRAVEL_SEARCH_ENABLED=false` disables searches after the supervisor restarts.
- The production-local Compose file enables security explicitly; missing access
  credentials fail closed. The fixture-only CI stack explicitly disables auth.
- Provider-agent HTTP and NATS ports are no longer published on the host. The UI
  and supervisor remain bound to loopback. Provider agents receive only their
  required configured environment rather than the complete `.env` file.

Quotas count admitted prompt attempts, including failed attempts and replay
requests; they are not an exact model-token or dollar budget. A single prompt
can make multiple model/provider calls. Keep provider billing controls as a
second layer. The minute/concurrency limits assume one supervisor process;
multi-worker or public deployment needs shared enforcement and real user identity.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `TRAVEL_ACCESS_KEY` | Missing means locked | Private app unlock secret |
| `TRAVEL_PROMPT_RATE_PER_MINUTE` | 10 | Prompt admission rate |
| `TRAVEL_PROMPT_DAILY_QUOTA` | 100 | Persistent daily request allowance |
| `TRAVEL_ACTIVE_PROMPTS` | 2 | Active request/stream ceiling |
| `TRAVEL_SECURITY_DB` | `/data/security.sqlite3` in Compose | Quota persistence |
| `TRAVEL_SEARCH_ENABLED` | true | Search kill switch |
| `TRAVEL_COOKIE_SECURE` | false locally | Require HTTPS for the cookie |
| `TRAVEL_ALLOWED_ORIGINS` | localhost:3000 and 127.0.0.1:3000 | Allowed browser origins |

Change settings in `.env`, then recreate the supervisor. Do not disable security
to troubleshoot browser login; check same-origin proxy and allowed origins first.
Trusted CLI clients can send `Authorization: Bearer <app unlock key>`; the smoke
script reads it from the environment without printing it. Treat this bearer as
a secret, and send it only to the intended app endpoint.

## Limits of this protection

Someone who controls your OS account, Docker daemon, `.env` file or provider key
can bypass app controls. Revoke exposed provider keys at the provider, rotate the
app key, and investigate that access. Loopback binding is not an OS sandbox.
Other containers on the same Docker network are trusted by this setup. Avoid
public tunnels and untrusted containers on that network.

No billing settings are changed. No promise is made that application quotas cap
provider charges to a particular dollar amount.

## Verification

Security tests must prove unauthorized, invalid-origin, quota-exhausted and
disabled-search requests never reach the paid handler. They also cover signed
cookie expiry/tampering, streaming slot cleanup, persistence and malformed input.
Browser tests cover unlock, reload, logout and non-persistence of the access key.
Verified on 2026-11-12:

- Docker backend suite: 210 tests passed; configured branch-inclusive coverage
  was 92.44% (this is the configured coverage set, not the entire repository).
- Browser suite: 130 tests passed across Chromium and Firefox.
- Python lint, frontend lint/format checks, TypeScript checks and production
  build passed. The existing frontend bundle-size warning remains.
- Persistence checks passed across API container replacement, and all 10
  fixture conversation evaluations passed.
- The running local app passed the same-origin proxy security probe: rejected
  anonymous prompts, rejected an untrusted origin, accepted login, and cleared
  the browser session on logout. Its authorized prompt used invalid input and
  never dispatched a model or provider search.
- Core containers are healthy. Only UI port 3000 and supervisor port 8000 are
  published, both on loopback. An old optional directory container with public
  port bindings was stopped; its data was preserved.

These checks used fixtures or invalid requests; no paid API searches were made.
