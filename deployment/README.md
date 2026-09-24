# Local Kubernetes deployment

Docker Compose is the verified default. The `helm/local-cluster` chart now contains
NATS, flight-agent, hotel-agent, activity-agent, travel-supervisor and UI. It has no
external chart dependencies or External Secrets operator requirement. It is a local,
single-replica deployment; service names are fixed to match agent cards, so install
one release per namespace. Optional observability and SLIM remain Compose profiles.

## Kind workflow

Requires Docker Desktop, kind, kubectl, Helm 3, and Bash/Make (for example WSL).
Run from `deployment/helm/local-cluster`:

```sh
make build
# Stop Compose first because Kind uses the same localhost ports 3000 and 8000:
docker compose -f ../../../docker-compose.yaml down
make create-cluster
make load-images
make secret
make apply
```

`make secret` reads the existing `.env` locally and creates `travel-agntcy-env` in
the `travel-agntcy` namespace. Credentials are never templated into chart values.
All Kubernetes mutations in the Makefile target context `kind-travel-agntcy`.
The UI URL is http://localhost:3000 and the API is http://localhost:8000.
VITE URLs are compiled into the Docker image; changing Helm environment variables
cannot change them. Rebuild the UI with the desired browser-accessible API URL.
If reloading images under the same `latest` tag, run `kubectl --context
kind-travel-agntcy -n travel-agntcy rollout restart deployment` after loading them.

For another cluster, build and push your own images, override `apps.*.image`,
`imagePullSecrets`, and `existingSecret`, then install using an explicit context.
Default Services are ClusterIP; `--set service.type=NodePort` exposes only UI and
supervisor. The Makefile and helmfile use NodePort for Kind. This chart is not a
production ingress, authentication, HA, or observability deployment.

After rollout, check `/health` and run the root smoke-test script against port 8000.
HTTP readiness probes establish process readiness; the live search verifies the
agent and provider path. `make destroy` removes only the Helm release; it preserves
the Secret and Kind cluster.

## Validation using Docker

From the repository root (PowerShell; substitute an absolute mount path on Linux):

```powershell
docker run --rm -v "${PWD}/deployment/helm:/charts:ro" alpine/helm:3.17.3 lint /charts/local-cluster /charts/ui --strict
New-Item -ItemType Directory -Force .runtime | Out-Null
docker run --rm -v "${PWD}:/workspace" -w /workspace --entrypoint sh alpine/helm:3.17.3 -c 'helm template travel-agntcy deployment/helm/local-cluster > .runtime/helm-default.yaml && helm template travel-agntcy deployment/helm/local-cluster --set service.type=NodePort > .runtime/helm-kind.yaml && helm template travel-ui deployment/helm/ui > .runtime/helm-ui.yaml'
docker run --rm -v "${PWD}/.runtime:/manifests:ro" ghcr.io/yannh/kubeconform:v0.6.7 -strict -summary /manifests/helm-default.yaml /manifests/helm-kind.yaml /manifests/helm-ui.yaml
```

Both charts lint and all 27 resources across these renders pass schema validation.
A live Kubernetes installation has not been exercised in this workspace.
`helm/ui` is an optional standalone UI chart; do not install it alongside the core
chart in the same namespace with conflicting service or NodePort names.
