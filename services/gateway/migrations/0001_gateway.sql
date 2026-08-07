CREATE TABLE IF NOT EXISTS flask_job_owners (
  job_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS flask_job_owners_user_idx ON flask_job_owners(user_id);
