# Travel agent directory integration

The optional publishing tool uses the current Flight Search Agent, Hotel Search
Agent, and Activity Search Agent A2A cards. The supervisor exposes a custom REST
API, so it is not advertised as an A2A server. Existing coffee records under
`oasf_records` are historical examples and are not selected for publication.

## Preview without publishing

After rebuilding the core images:

```sh
docker compose exec -T travel-supervisor uv run --no-sync python -m scripts.publish_agent_records --dry-run
```

This prints the three cards and needs no directory SDK extras, credentials or
network calls. The URLs use Docker service names and are reachable by clients on
the Compose network; adapt the card URLs before publishing for external clients.

## Optional local publication

From Bash/WSL, run `bash scripts/publish_agent_records.sh`. It starts only the local
directory registry/API and OASF translator, waits for configured health checks,
and runs the publisher in a disposable supervisor container with the locked dev
extra installed. That extra is large and also contains unrelated upstream test
packages. It leaves services running and writes generated records and CIDs under
`.runtime/directory/`. `--dry-run` avoids starting the optional services.

Direct Python usage is `uv run --locked --extra dev python -m
scripts.publish_agent_records`. Optional overrides are `OASF_HOST`,
`DIRECTORY_CLIENT_SERVER_ADDRESS`, `OASF_RECORDS_DIR`, and `--output`.
Stop only these optional services when finished:

```sh
docker compose --profile directory --profile oasf-translate stop dir-api-server zot oasf-translation-service
```

The dry-run path is verified. Live translation/publication is not: the optional
registry services were previously unhealthy on this machine. Their recovery and
external directory publication remain separate from the working core app.
