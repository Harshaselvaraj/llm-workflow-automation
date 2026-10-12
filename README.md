# FlowForge — LLM workflow automation

A first working slice of a generic automation platform: **Input → AI → Rules → Approval → Output**. React provides a configuration form and execution dashboard. FastAPI stores workflow definitions, frozen per-run configurations, model results, step history and approval decisions in SQLAlchemy (SQLite locally, PostgreSQL with Compose).

## Run locally

Requires Python 3.12+ and Node 22+.

```sh
cd /workspace/llm-workflow-automation
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.lock.txt
cd frontend
npm ci --cache /tmp/flowforge-npm-cache
cd ../backend
../.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In another terminal, run `npm run dev` from `frontend`. Vite proxies `/api` to the backend. The backend uses the ignored `backend/.data/workflows.db` by default; to override its location set `DATABASE_URL=sqlite:////absolute/path/workflows.db`. API documentation is served at `/docs` on the backend.

Create a demo automation, submit the example JSON, inspect the results and approve or reject it. Demo mode requires no credentials and **does not use an LLM**: extraction preserves a JSON object or returns text; summarization truncates text; classification returns a demo label. Instructions affect live providers only.

## Model adapters and documents

- **OpenAI**: set `LLM_API_KEY` in the backend process, choose OpenAI and a compatible model (default `gpt-4o-mini`). The adapter requests JSON output from the OpenAI chat completions endpoint.
- **Ollama**: run Ollama separately, pull a model, set `OLLAMA_URL` if needed, and choose the installed model name, e.g. `llama3.2`. The adapter calls `/api/generate` with JSON formatting.
- Both live adapters return JSON objects. The engine retries connection/timeouts once and records failures without storing raw provider errors or credentials.
- Upload UTF-8 text/JSON or text-based PDFs up to 5 MB, 100 pages, and 100,000 extracted characters. Scanned PDFs need OCR, which is not implemented. Files are processed and discarded; extracted output persists.

## Rules, approvals and output

Rules operate on JSON fields (nested paths such as `invoice.amount` are supported): `exists`, `equals`, or numeric `greater_than`. All rules must pass. Failure halts output; it does not request approval. Approval can be required for every passing run. Only pending runs can be approved/rejected; PostgreSQL locks concurrent decisions. SQLite is intended for single-user development.

Output saves results or POSTs `{run_id, result}` to a configured HTTPS webhook. Set `WEBHOOK_ALLOWED_HOSTS` to administrator-trusted destination hostnames. URLs containing credentials, non-HTTPS URLs, non-443 ports and redirects are rejected. Keep the allowlist limited to trusted public services and enforce egress policy outside the process: DNS resolution is not a complete SSRF boundary. The destination should deduplicate `Idempotency-Key` (the run ID). External actions are not automatically retried because timeout does not establish whether a write succeeded.

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Check application and database |
| GET / POST | `/api/workflows` | List / create definitions |
| POST | `/api/workflows/{id}/runs` | Execute `{ "text": "..." }` |
| POST | `/api/workflows/{id}/upload` | Execute multipart `file` input |
| GET | `/api/runs` | Execution history |
| GET | `/api/runs/{id}` | Result and steps |
| POST | `/api/runs/{id}/decision` | `{ "approve": true, "comment": "..." }` |

## Test and build

```sh
cd backend
../.venv/bin/pytest -q
cd ../frontend
npm run build
```

Tests exercise persistence, rules, approvals, rejection, uploads, webhook restrictions and both live adapter contracts using mocked provider responses. Actual provider calls require credentials or a running Ollama model.

## Portable local deployment

Copy `.env.example` to `.env` and supply a URL-safe `POSTGRES_PASSWORD`. Run `docker compose up --build`. Compose connects PostgreSQL, the backend and an Nginx frontend, binding the UI to loopback port 8080. This configuration is for local deployment, not public exposure. Database state lives in a named volume; `docker compose down -v` deletes it. Docker builds and runtime availability depend on your host.

## Production roadmap and current boundaries

This is a functional single-user prototype. It has no authentication, tenant isolation or user identity for approval. Keep it on loopback. Do not expose customer data or public endpoints until these controls are implemented.

Execution currently happens synchronously in the request. Results persist, but in-flight runs do not resume after crashes; a crash can leave `running` or `delivering` records. It is not a durable workflow engine. Introduce Temporal workers with explicit activity retries and an outbox/idempotent delivery protocol before production. Also add OIDC roles and audited actor identities, migrations, pagination/retention, rate limits, secrets management, parser sandboxing, S3-compatible document storage, and deployment/security tests. PostgreSQL support and portable containers are provided; Temporal, S3 and OIDC are not wired in yet.

Next capabilities: inbound webhook triggers and schedules, authenticated API connectors, notifications, RAG with pgvector, then approved-tool agent tasks. Drag-and-drop editing can follow once these workflow contracts are stable.
