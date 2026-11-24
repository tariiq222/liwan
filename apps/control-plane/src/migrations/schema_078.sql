-- Tenant object storage: one row per SaaS tenant that gets its own OCI bucket, IAM user and secret key (tools/shared_saas_lifecycle/tenant_storage_effect.py).
-- The shared worker runs the effect from this row. The effect keeps no state of its own: OCI and the tenant's fs.storage records are the truth, and each
-- run reconciles them. A new OCI key works after about 7 minutes, so a run answers `pending_key` and the next run is scheduled, not awaited.
-- shared_jobs is not used: its jobs are single, fenced and never repeated after an error, and a job in needs_intervention blocks every other job of the
-- tenant, while this work is a series of repeatable reconciliations that must not block backups or reconfigurations.
-- An operator's request is recorded in audit_events (tenant_storage.requested), not here.
-- `response` holds the effect's answer (state, stage, ids of the run); it never holds a key or a secret.
CREATE TABLE tenant_storage (
  control_tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  operation text NOT NULL DEFAULT 'ensure' CHECK (operation IN ('ensure','verify','rotate')),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','pending_key','active','failed')),
  stage text CHECK (stage IN ('resources_ready','key_issued','key_stored','verified')),
  error_code text CHECK (error_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- NULL: nothing is due (active, or failed for good until an operator asks again).
  next_run_at timestamptz DEFAULT clock_timestamp(),
  -- The id of the run in flight (the effect's requestId) and the revision a result must still match to be recorded.
  request_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  response jsonb CHECK (response IS NULL OR jsonb_typeof(response) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (state <> 'active' OR (COALESCE(stage, '') = 'verified' AND error_code IS NULL))
);
CREATE INDEX tenant_storage_due ON tenant_storage (next_run_at) WHERE next_run_at IS NOT NULL;
