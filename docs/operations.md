# AIREM production operations

## Canonical production path

Production traffic follows one path:

`Browser → Nginx TLS → React / /api/* → Accounts or Gateway → /internal/v1/* Python processor`

PostgreSQL stores accounts, ownership, orchestration state and usage. Redis/BullMQ provides asynchronous execution. The Python processor owns deterministic v21 document processing and the document workspace volume.

Legacy Flask/Jinja URLs are not public production routes. Do not add Nginx proxy locations for `/job`, `/rewrite`, `/formatting`, `/preview`, or `/download`; browser artifacts must use `/api/documents/preview/*` and `/api/documents/download/*`.

## Readiness

Public `GET /healthz` is healthy only when the gateway can reach the processor and a BullMQ worker is registered. Gateway readiness includes:

```json
{"ok":true,"processor":"ready","queue":{"workersAvailable":true}}
```

Processor `GET /healthz` confirms the v21 JSON composition app imported successfully. A healthy Redis container alone is not sufficient for queued-job readiness.

## Structured logs

Gateway access/error logs include request ID, owner context, method, route, upstream resource, response status and duration without request/response bodies.

The worker emits JSON lifecycle events suitable for container-log collection:

- `worker_ready`
- `job_started`
- `job_completion_recorded`
- `job_retry_scheduled`
- `job_cancelled`
- `job_rejected`
- `job_failed`
- `bullmq_completed`
- `bullmq_failed`
- `worker_error`
- `worker_cleanup`
- `worker_shutdown`

Correlate processing incidents by `jobId` and `attempt`; correlate synchronous requests by `x-request-id`.

Useful commands:

```bash
docker compose ps
docker compose logs -f --tail=200 frontend accounts gateway worker processor
docker compose logs worker | grep 'job_retry_scheduled\|job_failed\|worker_error'
```

## Database diagnostics

Recent orchestration state:

```sql
SELECT id, operation, state, progress, attempt, max_attempts, error_code,
       created_at, started_at, finished_at, updated_at
FROM orchestration_jobs
ORDER BY created_at DESC
LIMIT 50;
```

Exactly-once charge/output audit:

```sql
SELECT j.id, j.state, j.word_count,
       c.words AS charged_words,
       o.id AS output_id
FROM orchestration_jobs j
LEFT JOIN orchestration_usage_charges c ON c.job_id = j.id
LEFT JOIN orchestration_outputs o ON o.job_id = j.id
WHERE j.id = '<job-uuid>';
```

A cancelled job must not have a usage-charge row or orchestration-output row. An idempotent/retried successful job must have at most one of each.

## Startup and migrations

Migrations must run before health-gated account/gateway services are expected to start successfully:

```bash
docker compose build
docker compose up -d postgres redis processor
docker compose up --wait --no-deps postgres redis processor
docker compose run --rm --no-deps accounts node dist/migrate.js
docker compose run --rm --no-deps gateway node dist/migrate.js
docker compose up -d accounts worker gateway frontend
docker compose up --wait --wait-timeout 240
```

Never point production at an un-migrated database and rely on service startup to create schema implicitly.

## Backups

Back up both PostgreSQL and the `documents` volume. Database rows alone do not contain uploaded/generated DOCX/PDF bytes.

```bash
mkdir -p backups
docker compose exec -T postgres pg_dump -U airem -d airem -Fc > backups/airem.dump
docker compose stop processor worker
docker run --rm -v airem_documents:/source:ro -v "$PWD/backups:/backup" alpine \
  tar czf /backup/documents.tgz -C /source .
docker compose start processor worker
```

Test restore procedures in staging before relying on a backup.

## CI and branch protection

PR10 defines the consolidated workflow **AIREM Production Cutover**. Its final aggregate job is named:

`AIREM Cutover Required`

Configure repository branch protection for `main` to require that status. The workflow itself cannot enforce GitHub repository branch-protection settings; that repository setting must be enabled in GitHub administration.

The aggregate status depends on:

1. protected v21 hash verification;
2. all Python regressions;
3. account and gateway migrations/typechecks/tests;
4. React lint/format/typecheck/unit tests and production build;
5. production image builds;
6. migration-before-health Compose startup;
7. canonical authenticated smoke test;
8. every test under `e2e/tests/full` against the real production stack.

## Incident rules

- `QUEUE_UNAVAILABLE`: verify worker registration and Redis connectivity before resubmitting.
- `PROCESSOR_UNAVAILABLE` / timeout: inspect processor health and gateway upstream logs; queued jobs retry only classified transient failures.
- `WORD_ALLOWANCE_EXCEEDED`: do not manually insert outputs or charges; allowance enforcement is transactional.
- `CANCELLED`: a late processor response is intentionally discarded and must not be charged.
- repeated `job_retry_scheduled`: inspect processor latency/resource pressure before increasing concurrency.
- never increase `WORKER_CONCURRENCY` or `PROCESSOR_WORKERS` without memory/CPU load testing on representative DOCX/PDF workloads.
