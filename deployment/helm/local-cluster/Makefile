SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
ENV_FILE ?= ../../../.env
CLUSTER := travel-agntcy
NAMESPACE := travel-agntcy
KUBE_CONTEXT ?= kind-$(CLUSTER)
IMAGES := flight-agent:latest hotel-agent:latest activity-agent:latest travel-supervisor:latest lungo-ui:latest nats:2.11-alpine

.PHONY: create-cluster build load-images secret apply lint destroy

create-cluster:
	kind create cluster --name $(CLUSTER) --config kind-config.yaml

build:
	cd ../../.. && docker compose build
	docker pull nats:2.11-alpine

load-images:
	kind load docker-image --name $(CLUSTER) $(IMAGES)

secret:
	kubectl --context $(KUBE_CONTEXT) create namespace $(NAMESPACE) --dry-run=client -o yaml | kubectl --context $(KUBE_CONTEXT) apply -f -
	kubectl --context $(KUBE_CONTEXT) -n $(NAMESPACE) create secret generic travel-agntcy-env --from-env-file=$(ENV_FILE) --dry-run=client -o yaml | kubectl --context $(KUBE_CONTEXT) apply -f -

apply:
	helm --kube-context $(KUBE_CONTEXT) upgrade --install travel-agntcy . --namespace $(NAMESPACE) --create-namespace --set service.type=NodePort --wait --timeout 10m

lint:
	helm lint . --strict

destroy:
	helm --kube-context $(KUBE_CONTEXT) uninstall travel-agntcy --namespace $(NAMESPACE)
