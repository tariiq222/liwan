-- A readiness recheck that could not read Odoo is retried with backoff instead of quarantining the signup at once.
-- `recheck_failures` counts consecutive unreadable rechecks; `recheck_after` keeps the row out of the batch until then.
ALTER TABLE shared_onboardings
  ADD COLUMN recheck_failures integer NOT NULL DEFAULT 0 CHECK(recheck_failures >= 0),
  ADD COLUMN recheck_after timestamptz;
