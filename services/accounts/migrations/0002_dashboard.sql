ALTER TABLE documents ADD COLUMN workflow_status text NOT NULL DEFAULT 'draft' CHECK (workflow_status IN ('draft','processing','review','complete','failed'));
ALTER TABLE documents ADD COLUMN protected_detail_count integer NOT NULL DEFAULT 0 CHECK (protected_detail_count >= 0);
ALTER TABLE documents ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX documents_owner_updated_idx ON documents(user_id, updated_at DESC);

ALTER TABLE account_usage ADD COLUMN period_start timestamptz;
ALTER TABLE account_usage ADD COLUMN period_end timestamptz;
UPDATE account_usage SET period_start=date_trunc('month', updated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', period_end=(date_trunc('month', updated_at AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC';
ALTER TABLE account_usage ALTER COLUMN period_start SET NOT NULL;
ALTER TABLE account_usage ALTER COLUMN period_end SET NOT NULL;
ALTER TABLE account_usage ADD CHECK (period_end > period_start);

CREATE TABLE usage_history (user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, month_start timestamptz NOT NULL, words_processed bigint NOT NULL DEFAULT 0 CHECK(words_processed >= 0), PRIMARY KEY(user_id, month_start));
INSERT INTO usage_history(user_id, month_start, words_processed) SELECT user_id, period_start, words_used FROM account_usage ON CONFLICT DO NOTHING;
CREATE TABLE review_warnings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, document_id uuid REFERENCES documents(id) ON DELETE CASCADE, message text NOT NULL, resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX review_warnings_owner_idx ON review_warnings(user_id) WHERE resolved_at IS NULL;
CREATE TABLE notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, title text NOT NULL, body text NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX notifications_owner_created_idx ON notifications(user_id, created_at DESC);
CREATE TABLE subscriptions (user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, plan_code text NOT NULL DEFAULT 'free', plan_name text NOT NULL DEFAULT 'Free', word_allowance bigint NOT NULL DEFAULT 0 CHECK(word_allowance >= 0), renewal_at timestamptz, provider text, provider_subscription_id text, updated_at timestamptz NOT NULL DEFAULT now(), CHECK ((provider IS NULL) = (provider_subscription_id IS NULL)));
INSERT INTO subscriptions(user_id, word_allowance) SELECT user_id, word_allowance FROM account_usage ON CONFLICT DO NOTHING;
COMMENT ON TABLE subscriptions IS 'Informational plan metadata only; billing is disabled until a payment provider and verified webhooks are implemented.';
