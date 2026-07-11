# WireMock Collector

Polls one or more WireMock admin APIs, stores request journals in PostgreSQL (with dedupe), and serves a React UI for requests, stubs, and scenarios.

## Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic, APScheduler, httpx
- **Frontend:** React + Vite + TypeScript (served by FastAPI in production)
- **DB:** PostgreSQL 16

## Quick start (Docker)

```bash
docker compose up --build
```

Open http://localhost:8000

1. Go to **Instances** — click **Search Docker** to auto-register WireMock containers, or add a base URL manually.
2. Click **Collect** or wait for the scheduler (default every 15s). The collector polls **all enabled instances**.
3. Browse **Requests**, **Stubs**, and **Scenarios**.

Docker discovery mounts the host Docker socket and looks for containers whose image/name/labels mention WireMock, then probes `/__admin`. New containers are added; existing ones are updated if their URL changed. Startup also runs a discovery pass.

## Publish image (Docker Hub)

Auto-versions from [`VERSION`](VERSION) + git tags. **Default channel is alpha** (`X.Y.Z-alpha`). Pass `beta` or `release` to override. **Default is a dry-run preview**; pass `--push` to build and publish.

```bash
docker login

./scripts/docker-publish.sh                 # preview next alpha  (e.g. 0.1.0-alpha)
./scripts/docker-publish.sh --push          # publish alpha (+ :alpha)

./scripts/docker-publish.sh beta            # preview 0.1.0-beta
./scripts/docker-publish.sh beta --push

./scripts/docker-publish.sh release         # preview what :latest will point to
./scripts/docker-publish.sh release --push  # publish X.Y.Z (+ :latest)
./scripts/docker-publish.sh release minor --push
```

Useful env vars: `DOCKER_IMAGE=user/name`, `PLATFORMS=linux/amd64,linux/arm64`, `SKIP_GIT_TAG=1`.

## Local development

Postgres is only reachable inside Compose by default (no host port). For a split local setup:

```bash
# Optional: expose DB on host 5433 if you run the API outside Docker
# Add under db: in docker-compose.yml → ports: ["5433:5432"]

docker compose up db -d

cd src/backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL=postgresql+asyncpg://collector:collector@localhost:5433/wiremock_collector
uvicorn app.main:app --reload --port 8000

cd ../frontend
npm install
npm run dev
```

UI: http://localhost:5173 (proxies `/api` to the backend).

## API overview

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/instances` | List / create WireMock instances |
| POST | `/api/instances/discover` | Scan Docker for WireMock containers and register new ones |
| PATCH/DELETE | `/api/instances/{id}` | Update / delete |
| POST | `/api/collect` | Collect from all enabled instances |
| GET | `/api/requests` | Query stored requests (`instance_id`, `method`, `matched`, `q`) |
| GET | `/api/query/schema` | Table/column reference for the SQL UI |
| POST | `/api/query` | Run a read-only SQL query (`SELECT` / `WITH` / `EXPLAIN`) |
| GET | `/api/instances/{id}/stubs` | Live stub mappings |
| GET | `/api/instances/{id}/scenarios` | Live scenarios |

Duplicates are ignored via unique constraint `(instance_id, wiremock_request_id)`.
