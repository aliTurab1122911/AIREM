# AIREM processing gateway

This service is the only HTTP caller allowed onto the processor network. It validates the account session, checks `flask_job_owners` before dispatching any job URL, streams request and download bodies, and retains the Flask field names and response bytes.

## Adapter routes

| Public route | Existing Flask route |
| --- | --- |
| `POST /api/documents/upload` | `POST /upload` |
| `/api/documents/jobs/:uuid` | `/job/:uuid` |
| `/api/documents/{preview,download}/:uuid/*` | `/{preview,download}/:uuid/*` |
| `/api/rewrite/*` | `/rewrite/*` |
| `/api/detection/{text,file}` | `/api/detect-{text,file}` |
| `/api/formatting/{analyse,apply/*}` | `/formatting/{analyse,apply/*}` |

Successful metadata responses are inspected only for the returned UUID. PDF and DOCX responses are piped directly. The gateway never logs bodies, file names, query strings, cookies, authorization values, or response contents. Usage is charged from the processor's `X-Airem-Words-Processed` success header in one conditional database transaction.

Run `npm run db:migrate` after the account migration, then `npm test` and `npm run build`.

## Runtime limits

`RATE_LIMIT_MAX` must be a positive integer and defaults to **60 requests per
minute per client**. Health checks are exempt. POST requests that upload or
start processor work (including `/api/jobs`) use the stricter
`max(1, floor(RATE_LIMIT_MAX / 6))` limit, which is **10 per minute** by
default. Invalid values stop the gateway during configuration loading.

The processor's `PROCESSOR_WORKERS` also must be a positive integer and
defaults to **2**. Its container entrypoint passes that value to Gunicorn's
`--workers` option and exits before starting Gunicorn when the value is invalid.
