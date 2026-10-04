-- C1 legacy -> SaaS commercial migration (additive only). Requires schema_012 and schema_013.
-- Registered as migration 14 in db.ts.
CREATE TABLE IF NOT EXISTS legacy_mappings (
  source_kind text NOT NULL, source_id text NOT NULL,
  target_kind text NOT NULL, target_id text,
  source_payload jsonb NOT NULL, source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
  migrated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_kind, source_id)
);
CREATE TABLE IF NOT EXISTS migration_runs (
  run_id uuid PRIMARY KEY, mode text NOT NULL CHECK(mode IN ('dry_run','run')),
  source_digest text NOT NULL, counts jsonb NOT NULL DEFAULT '{}'::jsonb, errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS commercial_setup_required boolean NOT NULL DEFAULT false;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS legacy_source jsonb;
