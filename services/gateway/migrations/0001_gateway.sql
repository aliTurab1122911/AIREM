CREATE TABLE IF NOT EXISTS flask_job_owners (
  job_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS flask_job_owners_user_idx ON flask_job_owners(user_id);

DO $$ BEGIN CREATE TYPE orchestration_job_state AS ENUM ('queued','processing','review_required','completed','failed','expired'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS orchestration_jobs (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key varchar(200) NOT NULL, operation varchar(50) NOT NULL, request jsonb NOT NULL,
  state orchestration_job_state NOT NULL DEFAULT 'queued', progress smallint NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  attempt integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 3,
  error_code varchar(80), error_message varchar(240), internal_error text, word_count integer, result jsonb, output_id uuid,
  cancel_requested_at timestamptz, started_at timestamptz, finished_at timestamptz,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS orchestration_jobs_owner_created_idx ON orchestration_jobs(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS orchestration_jobs_cleanup_idx ON orchestration_jobs(state,expires_at);
CREATE TABLE IF NOT EXISTS orchestration_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL UNIQUE REFERENCES orchestration_jobs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, metadata jsonb NOT NULL DEFAULT '{}', expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orchestration_usage_charges (
  job_id uuid PRIMARY KEY REFERENCES orchestration_jobs(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  words integer NOT NULL CHECK(words >= 0), created_at timestamptz NOT NULL DEFAULT now()
);
