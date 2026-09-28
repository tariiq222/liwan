-- Package-5 backup authority: durable, insert-only records of consistent
-- tenant snapshots. A record exists only after independent readback
-- verification, so consistency is 'verified' at insert; there is deliberately
-- no 'unverified' stored state and no mutation path.
CREATE TABLE shared_backups (
  id uuid PRIMARY KEY,
  control_tenant_id uuid NOT NULL REFERENCES tenants(id),
  tenant_id text NOT NULL,
  database_name text NOT NULL,
  filestore text NOT NULL,
  snapshot jsonb NOT NULL,
  database_sha256 text NOT NULL CHECK (database_sha256 ~ '^[a-f0-9]{64}$'),
  filestore_sha256 text NOT NULL CHECK (filestore_sha256 ~ '^[a-f0-9]{64}$'),
  artifact_path text NOT NULL,
  consistency text NOT NULL CHECK (consistency = 'verified'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION shared_backup_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'backup records are append only'; END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'backup records are permanent'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER shared_backups_immutable BEFORE UPDATE OR DELETE ON shared_backups
  FOR EACH ROW EXECUTE FUNCTION shared_backup_append_only();

-- Restore is a separately authorized operator decision: an approval grants
-- exactly one restore of one verified backup, to a NEW target only, before it
-- expires. Consumption is recorded transactionally; a consumed approval can
-- never authorize a second restore.
CREATE TABLE shared_restore_approvals (
  id uuid PRIMARY KEY,
  backup_id uuid NOT NULL REFERENCES shared_backups(id),
  control_tenant_id uuid NOT NULL REFERENCES tenants(id),
  target_database text NOT NULL,
  reason text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX shared_restore_approval_once ON shared_restore_approvals(id) WHERE consumed_at IS NOT NULL;
CREATE FUNCTION shared_restore_approval_consumed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'restore approval already consumed'; END IF;
  IF NEW.backup_id IS DISTINCT FROM OLD.backup_id OR NEW.control_tenant_id IS DISTINCT FROM OLD.control_tenant_id
     OR NEW.target_database IS DISTINCT FROM OLD.target_database OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'restore approval identity is immutable';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER shared_restore_approval_guard BEFORE UPDATE ON shared_restore_approvals
  FOR EACH ROW EXECUTE FUNCTION shared_restore_approval_consumed();
