# S4 - Super Simple Storage Service
# Makefile for building and deploying S4
#
#sskjd;lskjd

# Container registry configuration
IMAGE_REGISTRY ?= quay.io
IMAGE_REPOSITORY ?= rh-aiservices-bu/s4
# Default tag from package.json version (override with IMAGE_TAG=xxx)
IMAGE_TAG ?= $(shell node -p "require('./package.json').version")
IMAGE ?= $(IMAGE_REGISTRY)/$(IMAGE_REPOSITORY):$(IMAGE_TAG)

# Container runtime (podman or docker)
CONTAINER_RUNTIME ?= $(shell command -v podman 2>/dev/null || echo docker)

# Kubernetes namespace
NAMESPACE ?= default

# Helm configuration
RELEASE_NAME ?= s4
CHART_PATH ?= charts/s4

.PHONY: help build push deploy undeploy dev test clean login helm-lint helm-template deploy-raw

help: ## Show this help message
	@echo "S4 - Super Simple Storage Service"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

build: ## Build the container image
	@echo "Building S4 container image..."
	$(CONTAINER_RUNTIME) build -t $(IMAGE) -f docker/Dockerfile .

push: ## Push the container image to registry
	@echo "Pushing S4 container image to $(IMAGE)..."
	$(CONTAINER_RUNTIME) push $(IMAGE)

login: ## Login to container registry
	@echo "Logging in to $(IMAGE_REGISTRY)..."
	$(CONTAINER_RUNTIME) login $(IMAGE_REGISTRY)

run: ## Run S4 locally in a container
	@echo "Running S4 locally..."
	$(CONTAINER_RUNTIME) run -d \
		--name s4 \
		-p 5000:5000 \
		-p 7480:7480 \
		-v s4-data:/var/lib/ceph/radosgw \
		-v s4-storage:/opt/app-root/src/data \
		$(IMAGE)
	@echo ""
	@echo "S4 is running:"
	@echo "  - Web UI: http://localhost:5000"
	@echo "  - S3 API: http://localhost:7480"

stop: ## Stop the local S4 container
	@echo "Stopping S4 container..."
	$(CONTAINER_RUNTIME) stop s4 || true
	$(CONTAINER_RUNTIME) rm s4 || true

helm-lint: ## Lint the Helm chart
	@echo "Linting Helm chart..."
	helm lint $(CHART_PATH)

helm-template: ## Render Helm templates locally
	@echo "Rendering Helm templates..."
	helm template $(RELEASE_NAME) $(CHART_PATH) --namespace $(NAMESPACE)

deploy: ## Deploy S4 using Helm
	@echo "Deploying S4 to Kubernetes namespace: $(NAMESPACE) using Helm..."
	helm upgrade --install $(RELEASE_NAME) $(CHART_PATH) \
		--namespace $(NAMESPACE) \
		--create-namespace \
		--wait
	@echo ""
	@echo "S4 deployed. Check status with: kubectl get pods -n $(NAMESPACE) -l app.kubernetes.io/name=s4"

undeploy: ## Remove S4 using Helm
	@echo "Removing S4 from Kubernetes namespace: $(NAMESPACE)..."
	helm uninstall $(RELEASE_NAME) --namespace $(NAMESPACE) --ignore-not-found || true

deploy-raw: ## Deploy S4 using raw manifests (legacy)
	@echo "Deploying S4 to Kubernetes namespace: $(NAMESPACE) using raw manifests..."
	kubectl apply -f kubernetes/s4-secret.yaml -n $(NAMESPACE)
	kubectl apply -f kubernetes/s4-configmap.yaml -n $(NAMESPACE)
	kubectl apply -f kubernetes/s4-pvc.yaml -n $(NAMESPACE)
	kubectl apply -f kubernetes/s4-deployment.yaml -n $(NAMESPACE)
	kubectl apply -f kubernetes/s4-service.yaml -n $(NAMESPACE)
	@echo ""
	@echo "S4 deployed. Check status with: kubectl get pods -n $(NAMESPACE) -l app=s4"

undeploy-raw: ## Remove S4 using raw manifests (legacy)
	@echo "Removing S4 from Kubernetes namespace: $(NAMESPACE)..."
	kubectl delete -f kubernetes/ -n $(NAMESPACE) --ignore-not-found

dev: ## Start development servers
	@echo "Starting development servers..."
	npm run dev

dev-install: ## Install development dependencies
	@echo "Installing dependencies..."
	npm install

test: ## Run tests
	@echo "Running tests..."
	npm run test

clean: ## Clean build artifacts
	@echo "Cleaning build artifacts..."
	rm -rf backend/dist
	rm -rf frontend/dist
	rm -rf node_modules
	rm -rf backend/node_modules
	rm -rf frontend/node_modules

all: build push deploy ## Build, push, and deploy
