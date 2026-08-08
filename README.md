# AIREM

AIREM is a document and writing workspace built around the protected v21 deterministic linguistic processor. Production uses a React frontend, authenticated Fastify services, PostgreSQL, Redis/BullMQ and the Python processor.

## Production architecture

```text
Browser
  ↓ HTTPS
Nginx + React
  ↓ /api/*
Accounts service / Gateway
  ↓ authenticated, owner-scoped requests
/internal/v1/* Python processor
  ↘ PostgreSQL
  ↘ Redis/BullMQ worker
  ↘ shared document volume
```

The browser has one supported API namespace: `/api/*`. Flask/Jinja application routes are retained only as internal implementation support for protected v21 behavior and are not public production interfaces.

## Main workflows

- **Word Document Rewriter** — DOCX inventory, automatic/manual/range/visual selection, immutable extraction, rewrite, unlimited explicit cycles, validation, reinsertion and download.
- **Turnitin + Selected Range Editing** — PDF verification, exact/expanded mapped ranges, manual or optional OpenAI review cards, direct export and Continue into AIREM.
- **Paste Text Rewriter** — standalone deterministic rewrite/compression controls.
- **Detection Studio** — pasted text or DOCX/TXT diagnostics with highest-risk passages.
- **Formatting Studio** — analysis, live preview, Word formatting controls and formatted DOCX export.
- **Queue Processing** — BullMQ orchestration with progress/SSE, retry classification, idempotency, cancellation, concurrency limits and exactly-once usage charging.

Normal AIREM rewriting is deterministic and does not call an LLM. The optional OpenAI range editor is a separate, user-invoked editorial feature.

## Development prerequisites

- Node.js 22+
- npm 10–11
- Python 3.12
- Docker + Docker Compose for the production stack

Install JavaScript workspaces:

```bash
npm ci
```

Install processor dependencies:

```bash
python -m pip install -r requirements.txt
```

## Verification

Protected processor baseline:

```bash
python ci/verify_protected_processing.py
```

All Python tests:

```bash
python -m pytest -q
```

Frontend production build:

```bash
npm run build --workspace airem-frontend
```

Gateway tests:

```bash
npm test --workspace @airem/gateway
```

Complete authenticated browser suite:

```bash
cd e2e
npm run test:full
```

The final CI aggregate status is **AIREM Cutover Required**. See `docs/operations.md` for startup, migration, readiness, logs, backup and branch-protection guidance.

## Production startup

Create TLS files under `deploy/tls/`, provide required secrets/environment variables, then run migrations before health-gated services:

```bash
docker compose build
docker compose up -d postgres redis processor
docker compose up --wait --no-deps postgres redis processor
docker compose run --rm --no-deps accounts node dist/migrate.js
docker compose run --rm --no-deps gateway node dist/migrate.js
docker compose up -d accounts worker gateway frontend
docker compose up --wait --wait-timeout 240
```

The public application defaults to `https://localhost:8443`.

## API and operations

- Final public API: `docs/api-contract.md`
- Production runbook and observability: `docs/operations.md`
- Processor protection hashes: `ci/protected-processing.sha256`

Do not add new browser calls to Flask routes or `/internal/v1/*`; new frontend functionality belongs behind the authenticated gateway contract.
