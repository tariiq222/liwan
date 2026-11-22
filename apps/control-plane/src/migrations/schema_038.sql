-- An operator's request to reconcile a shared job that sits in needs_intervention. The API records it; only the shared
-- worker can observe the tenant's Odoo effect, so the worker reads the pending rows and runs the recovery. One row per
-- job: a request that ended without verifying the effect can be made again.
CREATE TABLE shared_job_recoveries (
  job_id uuid PRIMARY KEY REFERENCES shared_jobs(id),
  issuer text NOT NULL,
  actor_uid bigint NOT NULL CHECK(actor_uid > 0),
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 1000),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','verified','still_needs_intervention','failed')),
  error text,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CHECK((state = 'pending') = (completed_at IS NULL)),
  CHECK((state = 'failed') = (error IS NOT NULL))
);
CREATE INDEX shared_job_recoveries_pending ON shared_job_recoveries(requested_at) WHERE state = 'pending';
