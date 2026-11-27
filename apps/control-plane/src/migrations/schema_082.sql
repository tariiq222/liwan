-- Removes the retired Track A packages (owner decision 2026-11-27) from a database that applied the old version 11,
-- which created them. Version 11 no longer does, so a fresh database never has them.
-- Runs in the migration transaction: a guard refuses the whole run until nothing depends on the packages any more.
DO $$
DECLARE
  pinned_count bigint;
  job_count bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'tenants'::regclass AND attname = 'package_revision_id' AND NOT attisdropped
  ) THEN
    EXECUTE 'SELECT count(*) FROM tenants WHERE package_revision_id IS NOT NULL' INTO pinned_count;
    IF pinned_count > 0 THEN
      RAISE EXCEPTION 'migration 82 refuses to drop tenants.package_revision_id: % tenant(s) still reference a retired Track A package revision; no tenant uses packages, so rebuild this database without them, or clear the column with tenant_package_guard disabled, then migrate again', pinned_count;
    END IF;
  END IF;

  SELECT count(*) INTO job_count FROM shared_jobs WHERE payload ? 'packageAuthority';
  IF job_count > 0 THEN
    RAISE EXCEPTION 'migration 82 refuses to drop the Track A packages: % shared_jobs row(s) still carry packageAuthority in payload; shared jobs are immutable and digest-bound, so rebuild this database without Track A package jobs, then migrate again', job_count;
  END IF;
END $$;

-- Order is load-bearing: a trigger goes before its function, and the column takes its index and foreign key with it.
DROP TRIGGER IF EXISTS tenant_package_guard ON tenants;
DROP TRIGGER IF EXISTS package_revision_guard ON package_revisions;
DROP FUNCTION IF EXISTS protect_tenant_package(), protect_package_revision();
ALTER TABLE tenants DROP COLUMN IF EXISTS package_revision_id;
DROP TABLE IF EXISTS package_revisions;
DROP TABLE IF EXISTS commercial_packages;
