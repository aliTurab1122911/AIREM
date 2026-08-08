# AIREM production API contract

AIREM production has one public application boundary: **React → `/api/*` → authenticated Fastify services → internal Python processor**. Browser clients must not call Flask/Jinja routes or `/internal/v1/*` directly.

All processor operations exposed to React return structured JSON. Binary artifacts are available only through the authenticated gateway routes `/api/documents/preview/{jobId}/{path}` and `/api/documents/download/{jobId}/{path}`. The React API boundary normalizes historical processor-generated `/preview/*` and `/download/*` strings before components receive them; those historical paths are not public production routes.

## Authentication, ownership and errors

Authentication uses the signed `session` cookie. Mutating same-origin requests use the CSRF cookie/header contract implemented by the account service and React API client. Processor jobs are owner-scoped by the gateway before any document, preview, download, rewrite, Turnitin, range-edit, or formatting call is forwarded.

Common statuses are `200/201/202` success, `400` malformed requests, `401` unauthenticated, `403` allowance/CSRF rejection, `404` unknown or non-owned resource, `409` workflow/idempotency conflict, `413` upload too large, `415` unsupported media, `422` schema validation, `429` rate/concurrency limit, `502` processor transport failure, and `503` unavailable queue/worker. Gateway errors use `{"error":{"code":"..."},"requestId":"..."}`.

## Canonical synchronous routes

### Documents
- `POST /api/documents/upload` — multipart `docx_file` (`.docx`); returns `{ok, job_id, job, inventory}`.
- `GET /api/documents/jobs/{jobId}` — current structured job/inventory/mapping.
- `GET /api/documents/preview/{jobId}/{path}` — authenticated inline artifact stream.
- `GET /api/documents/download/{jobId}/{path}` — authenticated attachment stream.

### Selection, Turnitin and range editing
- `POST /api/ranges/{jobId}/extract` — `automatic | manual | range | visual` extraction.
- `GET /api/ranges/{jobId}/chunks` — immutable extraction chunks.
- `POST /api/turnitin/{jobId}` — multipart `turnitin_pdf`.
- `GET /api/ranges/configuration` — optional OpenAI range-editor configuration.
- `POST /api/ranges/{jobId}/draft` — manual or optional OpenAI drafts using `visual_ranges`, `manual_only`, optional `prompt/model`.
- `POST /api/ranges/{jobId}/export` — `{session_id, edits:[{id,revised_text}]}` direct DOCX export.
- `POST /api/ranges/{jobId}/continue` — same approved-edit shape; creates the immutable continued extraction.

The former `/api/openai/ranges/{jobId}/draft` alias is retired. OpenAI is selected through the canonical range-draft request rather than a separate public route.

### Rewrite, validation and reinsertion
- `GET /api/rewrite/profiles` — supported v21 profiles from `/internal/v1/rewrite/profiles`.
- `POST /api/rewrite/{jobId}` — initial deterministic document rewrite.
- `POST /api/rewrite/{jobId}/cycles` — explicit unlimited cycle with current `edited_texts`.
- `POST /api/validation/{jobId}` — validate `{edited_texts}` against immutable mapping.
- `POST /api/reinsertion/{jobId}` — reinsert validated `{edited_texts}`.

Canonical profiles are `light`, `natural`, `rewrite_compress`, `compress`, `plain`, `expanded`, `conservative`, `balanced`, and `manual`. Engines are `linguistic | legacy`; writing styles are `natural_student | simple_student | natural_academic | plain_professional`.

### Secondary studios
- `POST /api/text/rewrite` — standalone pasted-text rewrite.
- `POST /api/detection/text` — pasted-text diagnostic.
- `POST /api/detection/file` — multipart `.docx` or `.txt` diagnostic.
- `POST /api/formatting/analyse` — multipart DOCX formatting analysis/live-preview source.
- `POST /api/formatting/apply/{jobId}` — `{settings: Record<string,string|number|boolean>}`.

## Queue-backed orchestration

`POST /api/jobs` requires an `Idempotency-Key` (8–200 characters) and `{operation,payload}`. Supported operations are `text_rewrite`, `text_detection`, `document_rewrite`, `document_validation`, and `formatting_apply`. Document operations carry `source_job_id` as gateway orchestration metadata; the worker strips it before calling the same `/internal/v1` resource used synchronously.

- New job: `202`.
- Same owner/key + identical operation/payload: original job, `200`, `idempotentReplay:true`.
- Same key + different request: `409 IDEMPOTENCY_KEY_REUSED`.
- No registered worker: `503 QUEUE_UNAVAILABLE` before job creation.
- User active-job limit: `429 USER_CONCURRENCY_LIMIT`.

`GET /api/jobs`, `GET /api/jobs/{id}`, `GET /api/jobs/{id}/events`, and `DELETE /api/jobs/{id}` are owner-scoped. States are `queued`, `processing`, `review_required`, `completed`, `failed`, and `expired`. SSE emits progress snapshots and treats every terminal state as terminal.

Workers retry transient network failures and HTTP `408, 425, 429, 500, 502, 503, 504` up to the configured maximum. Completion, output publication, allowance enforcement and usage charging are atomic in PostgreSQL; the unique charge/output rows make retries exactly-once from the account perspective. In-flight cancellation is cooperative: a completed processor response is discarded and not charged after cancellation has been requested.

## Usage accounting

Charging does not depend on `x-airem-words-processed`. Both synchronous and queued paths derive billable words from canonical processor JSON:
- pasted rewrite → `original_words`;
- detection → `report.word_count`;
- document rewrite → `word_budget.source_words` with `original_words` fallback.

Validation and formatting application are not assigned a word-processing charge by this contract.

## Internal processor boundary

The Python service remains the authoritative v21 domain engine. Production gateway calls use `/internal/v1/*`; legacy Flask/Jinja handlers may remain internally because protected v21 functions are still reused by the JSON composition layer, but they are not a supported browser/API surface. Nginx exposes only React and `/api/*`.
