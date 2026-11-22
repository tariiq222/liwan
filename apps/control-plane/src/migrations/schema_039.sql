-- Abandoning a stuck shared job (issue 446). A job whose effect is absent in Odoo can be closed by an operator: it ends
-- `failed`, which lifts the tenant's block (only running and needs_intervention jobs block) and is never retried by
-- itself. The API records the request; only the shared worker can observe the tenant's Odoo, so the worker re-observes
-- the effect and either closes the job or refuses because the effect exists. One row per job.
ALTER TABLE shared_jobs DROP CONSTRAINT shared_jobs_state_check;
ALTER TABLE shared_jobs ADD CONSTRAINT shared_jobs_state_check CHECK(state IN ('queued','running','verified','needs_intervention','failed'));
CREATE TABLE shared_job_abandonments (
  job_id uuid PRIMARY KEY REFERENCES shared_jobs(id),
  issuer text NOT NULL,
  actor_uid bigint NOT NULL CHECK(actor_uid > 0),
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 1000),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','abandoned','effect_present','failed')),
  error text,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CHECK((state = 'pending') = (completed_at IS NULL)),
  CHECK((state = 'failed') = (error IS NOT NULL))
);
CREATE INDEX shared_job_abandonments_pending ON shared_job_abandonments(requested_at) WHERE state = 'pending';
