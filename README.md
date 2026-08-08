# AIREM v21 Document Studio

AIREM v21 is a Flask/Python DOCX rewriting and formatting application. Its normal rewrite algorithm is now a **pure linguistic, deterministic pipeline**: it does not load or call FLAN-T5, BART, PEGASUS, Sentence-Transformers, NLI models or any other ML model.

The optional OpenAI range editor is retained as a separate user-invoked editing tool. It is not part of the Linguistic V1 rewrite algorithm.

## JavaScript dependency toolchain

The repository-level npm workspace covers the frontend, both Node services, the
shared contracts package, and the Playwright end-to-end tests. The dependency
lockfile was generated and validated with **Node.js 24.15.0** and **npm 11.4.2**;
application containers and CI run on Node.js 22, which is also supported by the
workspace engine range. Run `npm ci` from the repository root for a reproducible
installation of every workspace.

## Main workflows

1. **Word Document Rewriter** — extract selected DOCX content, rewrite it and reinsert it into the source document.
2. **Paste Text Rewriter** — rewrite or compress pasted text without DOCX mapping.
3. **Range Selector** — automatic, start/end, manual multi-range, visual multi-range and Turnitin-highlight mapping.
4. **Detection Studio** — diagnostic pattern analysis for pasted text or DOCX/TXT files.
5. **Formatting and Caption Studio** — live DOCX preview plus document-wide fonts, headings, margins, tables, captions, page numbers, TOC, List of Figures and List of Tables.

## Linguistic V1 rewrite pipeline

The default rewriter follows this sequence:

1. Normalize the selected line or paragraph.
2. Build a Protected Content Registry.
3. Replace protected spans with temporary placeholders.
4. Generate deterministic linguistic alternatives.
5. Apply lexical simplification and common-word substitutions.
6. Apply safe sentence/clause restructuring.
7. Generate selected v12-style conversational/decompression alternatives as intermediate candidates.
8. Compress every candidate toward the requested word-count target.
9. Reject candidates that lose protected content or too much lexical content.
10. Rank the remaining candidates for preservation, linguistic independence, readability and length fit.
11. Restore protected content byte-for-byte.
12. Validate DOCX section/line structure before reinsertion.

The AIREM detection score may be displayed after rewriting, but it is **not used** in candidate generation, candidate ranking, rewrite acceptance or rollback.

## What is protected before rewriting

AIREM automatically isolates many factual or technical spans, including:

- integers, decimals and other numerical data;
- percentages and monetary amounts;
- dates, times and years;
- measurements and dimensions;
- citations and quoted text;
- URLs, email addresses and DOIs;
- equations and code-like identifiers;
- function calls and file names;
- software/model version strings and parameter-size strings such as `7B`;
- acronyms;
- likely person/organisation names;
- repeated technical phrases and repeated product/model terms.

The Word and pasted-text rewriters also provide an **Additional protected terms** input for course-specific terminology that must remain exactly unchanged.

## v12 strategy retained without the v12 word-count problem

AIREM v12 was effective because it generated many lexical/decompression/conversational variants. Its Expanded profile, however, targeted about 126% of the original length.

v21 keeps the useful transformation ideas but changes the order:

`protected source -> strong linguistic variants -> compression -> candidate selection`

V12-style expanded wording is therefore only an intermediate path. It is compressed before it can become the selected output.

## Rewrite modes

- **Light Rewrite** — small lexical and structural changes, near-original length.
- **Natural Rewrite** — default strong linguistic rewriting, then compression toward approximately the original length.
- **Rewrite + Compress** — strong linguistic change plus more aggressive shortening.
- **Compress Only** — removes padding and redundancy while preserving content.
- **Simple Student** — simpler vocabulary, shorter sentences and optional contractions.
- **Strong Rewrite** — maximum deterministic restructuring available in the pure linguistic engine.
- **Manual Controls** — tune lexical intensity, compression, contractions, content preservation and long-sentence handling.

Writing styles include Natural Student, Simple Student, Natural Academic and Plain Professional.

## Unlimited rewrite cycles

`Rewrite Current Text Again` has no cycle cap. Every click uses the current edited text as the source for one more deterministic pass and rotates lexical alternatives with a cycle seed.

There is no detection-score or quality-improvement rollback policy in v21. A pass can only fall back when it breaks fixed structural/protected-content safeguards needed for factual integrity and DOCX reinsertion.

## Installation

On Windows, extract the ZIP and run:

```text
run_app.bat
```

Or install manually:

```bash
python -m pip install -r requirements.txt
python app.py
```

Open:

```text
http://127.0.0.1:5000
```

## Requirements

The core application uses lightweight Python packages only:

- `python-docx`
- `Flask`
- `Werkzeug`
- `python-dotenv`
- `PyMuPDF` for Turnitin PDF mapping
- `openai` only for the optional, separate OpenAI range-edit panel

No Transformer/ML package is required by the normal rewriter.

## Optional OpenAI range editor

If you want to use the separate range-edit panel, copy `.env.example` to `.env` and set:

```text
OPENAI_API_KEY=...
OPENAI_MODEL=...
```

Without an API key, the linguistic rewriter, manual range editing, detection, formatting, Turnitin mapping and DOCX reinsertion still work.

## Production note

The built-in detection report is an experimental writing-pattern diagnostic. It does not establish authorship and should not be treated as equivalent to a third-party detection system.

## Container deployment and operations

The Compose stack publishes **only HTTPS on port 8443**. PostgreSQL, Redis, the
accounts API, gateway, and unchanged Flask processor are reachable only on the
internal `backend` network. Nginx terminates TLS, caps uploads at 25 MiB, and
proxies application requests. Use a certificate whose names match the public
host; production certificates should come from your ingress or ACME provider.

### Local startup, database migrations, and first account

1. Install Docker Engine with Compose v2, then create configuration and a local
   TLS certificate (do not commit either `.env` or private keys):

   ```bash
   cp .env.example .env
   mkdir -p deploy/tls
   openssl req -x509 -newkey rsa:3072 -nodes -days 30 \
     -keyout deploy/tls/tls.key -out deploy/tls/tls.crt -subj '/CN=localhost' \
     -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1'
   chmod 600 deploy/tls/tls.key
   ```

   Replace the placeholder database password and cookie secret in `.env`.
2. Start the stateful dependencies, apply both versioned migration sets, and
   then start the application:

   ```bash
   docker compose up -d postgres redis
   docker compose run --rm accounts node dist/migrate.js
   docker compose run --rm gateway node dist/migrate.js
   docker compose up -d
   docker compose ps
   ```

3. Browse to `https://localhost:8443` (the self-signed local certificate causes
   an expected browser warning). Create the initial account through the **Create
   account** screen. Registration is the supported bootstrap path; there is no
   default password or account baked into an image. It may also be submitted to
   `POST /api/auth/register` through the TLS proxy.

The standard local stack includes one worker because the React workspace reads
and submits queue-backed `/api/jobs` workflows. The gateway readiness check is
unhealthy, and new queued submissions receive `503 QUEUE_UNAVAILABLE`, until a
worker has registered with Redis. Scale workers according to available CPU and
RAM; each worker defaults to two concurrent document jobs and is capped
separately:

```bash
docker compose up -d --scale worker=2
```

Do not increase `WORKER_CONCURRENCY` without load testing. DOCX/PDF operations
can consume substantial memory, and the Compose limits deliberately bound both
processors and workers. Containers receive SIGTERM, use an init process, and
have 45-second (PostgreSQL: 60-second) graceful-stop windows.

### Logs, backup, and restore

Application logs go to container stdout/stderr and contain no request bodies:

```bash
docker compose logs -f --tail=200 frontend accounts gateway processor worker
```

Create database and controlled-document-volume backups while the stack is
quiescent. Database dumps are consistent online; stop document writers while
archiving the volume. The `documents` volume is mounted at `/app/workspace` in
the processor and contains the complete per-job workspaces, including uploaded
source documents and generated downloads:

```bash
mkdir -p backups
docker compose exec -T postgres pg_dump -U airem -d airem -Fc > backups/airem.dump
docker compose stop processor worker
docker run --rm -v airem_documents:/source:ro -v "$PWD/backups:/backup" alpine \
  tar czf /backup/documents.tgz -C /source .
docker compose start processor
```

To restore, use a fresh/empty database and document volume. The following is
destructive and should be tested in a staging environment first:

```bash
docker compose down
docker volume rm airem_postgres-data airem_documents
docker compose up -d postgres
docker compose exec -T postgres dropdb -U airem --if-exists airem
docker compose exec -T postgres createdb -U airem airem
docker compose exec -T postgres pg_restore -U airem -d airem --clean --if-exists < backups/airem.dump
docker run --rm -v airem_documents:/target -v "$PWD/backups:/backup:ro" alpine \
  tar xzf /backup/documents.tgz -C /target
docker compose up -d
```

On startup, the one-shot `documents-init` service restores ownership of the
mounted `/app/workspace` tree to the processor's non-root `airem` user. This
also makes files from an older backup or Docker-created volume writable before
the processor starts.

### Upgrades and teardown

Back up first, review release notes and migration SQL, then rebuild, migrate,
and replace containers. Roll back application images only when the database
schema remains compatible.

```bash
git pull --ff-only
docker compose build --pull
docker compose run --rm accounts node dist/migrate.js
docker compose run --rm gateway node dist/migrate.js
docker compose up -d --remove-orphans
docker image prune -f
```

Stop containers while retaining data with `docker compose down`. To permanently
delete PostgreSQL and stored documents, confirm that backups are usable, then
run `docker compose down --volumes --remove-orphans`. The latter cannot be
undone.
