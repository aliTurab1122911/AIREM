# Gateway API contract

The account gateway is the public boundary for the legacy Flask processor. New clients **must not call Flask routes directly**. Every route below requires the signed `session` cookie, is rate limited, returns `x-request-id`, and enforces job ownership. The TypeScript types and runtime Zod schemas are published by `@airem/contracts` in `packages/contracts`.

## Common behaviour

Success responses from JSON-based processor operations are passed through as JSON. A processor response that historically rendered a page is represented as:

```json
{"representation":"legacy-html","content_type":"text/html; charset=utf-8","html":"<!doctype html>..."}
```

This compatibility representation deliberately preserves all legacy content while giving API clients a stable JSON envelope. Binary preview/download bodies are streamed without buffering. Processor-generated `download_url`, `log_url`, `report_url`, and `replacement_log_url` values are relative legacy links; clients should convert `/download/{job}/{path}` to `/api/documents/download/{job}/{path}`.

Common statuses are `200` success, `400` malformed JSON or missing multipart field, `401` no valid session, `404` unknown/not-owned job or result, `413` upload exceeds `UPLOAD_MAX_BYTES`, `415` wrong content type/extension, `422` schema validation failure, `429` rate limit, and `502` processor/response error. Gateway errors have `{"error":{"code":"...","issues":[{"path":"field","message":"..."}]},"requestId":"..."}`. Validation issues are returned with `422 VALIDATION_ERROR`; invalid JSON uses `400 INVALID_JSON`.

The document, range, rewrite, validation, reinsertion, detection, formatting, preview, download, and optional OpenAI adapter routes documented below are synchronous gateway-to-Flask workflows. They return the processor response on the original request and do not require a queue worker. Their legacy processor payloads may expose `queued`, `extracting`, `rewriting`, `validating`, `reinserting`, `complete`, or `failed` while the Flask workflow advances.

## Documents and inventory

| Method and path | Request | Result |
|---|---|---|
| `POST /api/documents/upload` | `multipart/form-data`; required field **`docx_file`**, `.docx` only; optional `max_words` form field | `200` legacy-HTML JSON containing the range inventory; `400/415` invalid upload |
| `GET /api/documents/jobs/{jobId}` | none | `200` legacy-HTML JSON containing inventory, extraction workspace, or formatting analysis according to job state |

The gateway claims a job UUID returned in HTML, JSON, or `Location`, associating it with the authenticated user. This preserves compatibility with Flask-generated job pages without modifying `app.py`.

## Range selection and extraction

`POST /api/ranges/{jobId}/extract` accepts JSON. `selection_mode` is `automatic`, `manual`, `range`, or `visual`; optional fields are `selected_blocks: string[]`, `start_order`, `end_order`, `visual_ranges`, and the booleans `include_headings`, `include_captions`, and `include_table_headers`. The adapter converts this to the legacy form post and returns the rendered workspace in the legacy-HTML JSON envelope.

Range editing routes are JSON:

* `POST /api/ranges/{jobId}/draft` — `visual_ranges` (non-empty) plus optional `manual_only`, `prompt`, and `model`.
* `POST /api/ranges/{jobId}/export` — `session_id` and either `replacements` or `edited_texts`; returns downloadable DOCX/log URLs.
* `POST /api/ranges/{jobId}/continue` — same approval payload; returns the legacy redirect information as JSON.

## Rewrite profiles and cycles

* `GET /api/rewrite/profiles` lists supported profiles.
* `POST /api/rewrite/{jobId}` starts an initial rewrite.
* `POST /api/rewrite/{jobId}/cycles` runs another cycle. Cycles remain unlimited for backward compatibility.

Rewrite JSON accepts `profile` (name or custom object), `profile_id`, `intensity` from 0 to 1, and legacy engine/profile settings. Unknown legacy keys pass through. Responses include edited chunks, validation, scoring, cycle number, acceptance/fallback information, and log URLs.

## Validation and reinsertion

* `POST /api/validation/{jobId}` validates `{edited_texts: Record<string,string>}` and returns diagnostics, `can_reinsert`, and the validation report URL.
* `POST /api/reinsertion/{jobId}` accepts the same structure and returns a DOCX download and replacement log when valid. Structural failures remain processor `400` responses.

## Standalone text rewriting

`POST /api/text/rewrite` requires non-empty `text`. Optional `profile`, `intensity`, and existing legacy tuning fields pass through. It returns rewritten text and rewrite diagnostics.

## Detection

* `POST /api/detection/text` requires JSON `{text: string}` with non-whitespace content.
* `POST /api/detection/file` requires multipart field **`file`**, with a `.docx` or `.txt` filename. The result includes the filename and detection report.

## Formatting

* `POST /api/formatting/analyse` requires multipart field **`docx_file`** (`.docx` only) and returns analysis/workspace HTML in the documented JSON envelope.
* `POST /api/formatting/apply/{jobId}` accepts JSON `{settings: Record<string, string | number | boolean>}`. The adapter translates booleans and values into the legacy form request; the result page is returned in the JSON envelope and contains download/report links.

## Preview and downloads

`GET /api/documents/preview/{jobId}/{path}` streams an inline result; `GET /api/documents/download/{jobId}/{path}` streams an attachment. Successful responses retain processor `Content-Type`, `Content-Disposition`, range/cache headers, and bytes. The gateway never materialises these bodies and rejects cross-account job access before contacting Flask.

## Optional OpenAI range editing

`POST /api/openai/ranges/{jobId}/draft` is an explicit opt-in alias for range drafts. It requires non-empty `visual_ranges`, accepts optional `prompt` and `model`, and forces/permits only non-manual behavior. Missing OpenAI configuration is reported by the processor as `400`; all other editing and rewriting remains local.

## Backward compatibility

Existing processor URLs and payloads are unchanged, and `app.py` remains the implementation of document operations. The gateway adapters only authenticate, authorize, validate, translate JSON-to-form where required, normalize rendered HTML, track usage, and stream files. Previously published gateway paths for documents, rewrite, detection, and formatting remain represented by the explicit routes above; direct legacy gateway catch-all routes are intentionally not part of the public contract.

## Queue-backed processing jobs

The `/api/jobs` orchestration API is asynchronous and requires at least one
registered worker. `GET /healthz` reports `200` with
`{"ok":true,"queue":{"workersAvailable":true}}` only when a worker is
available; otherwise it reports `503`, and `POST /api/jobs` returns
`503 QUEUE_UNAVAILABLE` without creating a database job. The default Compose
stack starts a worker.

Authenticated clients create a job with `POST /api/jobs`, an `Idempotency-Key` header (8–200 characters), and JSON `{ "operation": "text_rewrite", "payload": { ... } }`. Supported operations are `text_rewrite`, `text_detection`, `document_rewrite`, `document_validation`, and `formatting_apply`; document operations include the existing Flask `source_job_id` in the payload. A new request returns `202`; replaying the same owner/key returns the original job with `200` and never enqueues another copy.

`GET /api/jobs/:id` and `GET /api/jobs` are owner-scoped. `GET /api/jobs/:id/events` emits bounded (at most 20 seconds) `progress` SSE events. Clients reconnect or use the status endpoint. `DELETE /api/jobs/:id` cancels only a Redis job that is still waiting or delayed. Public states are `queued`, `processing`, `review_required`, `completed`, `failed`, and `expired`.

Workers retry only network errors and HTTP 408, 425, 429, 500, 502, 503, or 504, up to three attempts with exponential backoff. Other failures are final. User responses contain stable codes and sanitized messages; worker logs retain stack traces with job IDs. PostgreSQL uniqueness constraints on the job idempotency key, output job ID, and usage charge job ID ensure retries cannot create multiple outputs or double-charge usage.
