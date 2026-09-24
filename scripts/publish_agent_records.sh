#!/usr/bin/env bash
# Publish only to the local optional directory stack. Requires Docker Compose v2.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ "${1:-}" == "--dry-run" ]]; then
    docker compose run --rm --no-deps travel-supervisor uv run --no-sync python -m scripts.publish_agent_records --dry-run
    exit 0
fi

docker compose --profile directory --profile oasf-translate up -d --wait --wait-timeout 180 zot dir-api-server oasf-translation-service
mkdir -p .runtime/directory
# Optional locked SDK dependencies are installed in the disposable container.
# Services are left running; never stop a user's pre-existing directory stack.
docker compose run --rm --no-deps \
    -e OASF_HOST=oasf-translation-service \
    -e DIRECTORY_CLIENT_SERVER_ADDRESS=dir-api-server:8888 \
    -e OASF_RECORDS_DIR=/output/records \
    -v "$(pwd)/.runtime/directory:/output" \
    travel-supervisor uv run --locked --extra dev python -m scripts.publish_agent_records --output /output/published_cids.json
