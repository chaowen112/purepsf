.PHONY: help up down logs ps psql backend-build backend-run backend-test frontend-dev frontend-build etl-install etl-test sqlc-gen

SHELL := /bin/bash

help:  ## Show available targets
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

up:  ## Start postgres (and backend if docker is installed)
	docker compose up -d postgres

down:  ## Stop docker services
	docker compose down

logs:  ## Tail docker logs
	docker compose logs -f

ps:  ## List docker services
	docker compose ps

psql:  ## Open psql in the postgres container
	docker compose exec postgres psql -U $${POSTGRES_USER:-purepsf} -d $${POSTGRES_DB:-purepsf}

# --- Backend ---

backend-build:  ## Compile the Go server
	cd backend && go build ./...

backend-run:  ## Run the Go server locally (uses .env)
	cd backend && set -a && source ../.env && set +a && go run ./cmd/server

backend-test:  ## Run Go tests
	cd backend && go test ./...

sqlc-gen:  ## Regenerate sqlc query code
	cd backend && sqlc generate

# --- ETL ---

etl-install:  ## Create venv and install ETL package
	cd etl && python3 -m venv .venv && .venv/bin/pip install -q -e ".[dev]"

etl-test:  ## Run ETL tests
	cd etl && .venv/bin/pytest -q

# --- Frontend ---

frontend-dev:  ## Run Vite dev server
	cd frontend && npm run dev

frontend-build:  ## Production build
	cd frontend && npm run build
