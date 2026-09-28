-- t5 shared-lane durable identity. Odoo stock derives filestore from `data_dir/filestore/<db>`,
-- so the shared runtime registry refuses database != filestore (see deploy/shared/README.md).
-- Provision is a lifetime singleton per tenant: UNIQUE (tenant_id, business_key) enforces that
-- at the DB even if enqueue/worker checks are bypassed. request_id remains transport/audit only.
--
-- Registered as version 4 in db.ts, transactionally under the migration lock.
-- Existing rows remain NULL: no guessed backfill, no effect on legacy uniqueness.
-- This constraint prepares storage only; shared execution remains disabled.
ALTER TABLE operations ADD COLUMN IF NOT EXISTS business_key text;
CREATE UNIQUE INDEX IF NOT EXISTS operations_business_key_unique
  ON operations (tenant_id, business_key)
  WHERE business_key IS NOT NULL;