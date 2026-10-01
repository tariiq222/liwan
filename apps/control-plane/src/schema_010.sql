-- Real Odoo artifacts are distinct from reference-table snapshots.
CREATE TABLE shared_odoo_backups (
  backup_id uuid PRIMARY KEY REFERENCES shared_backups(id),
  job_id uuid NOT NULL UNIQUE REFERENCES shared_jobs(id),
  format text NOT NULL CHECK(format='odoo-pg-filestore-v1'),
  manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),
  source_registry_revision bigint NOT NULL CHECK(source_registry_revision>0)
);
CREATE TRIGGER shared_odoo_backups_immutable BEFORE UPDATE OR DELETE ON shared_odoo_backups
  FOR EACH ROW EXECUTE FUNCTION shared_backup_append_only();
CREATE TABLE shared_odoo_restore_targets (
  approval_id uuid PRIMARY KEY REFERENCES shared_restore_approvals(id),
  backup_id uuid NOT NULL REFERENCES shared_odoo_backups(backup_id),
  control_tenant_id uuid NOT NULL REFERENCES tenants(id),
  target_database text NOT NULL UNIQUE CHECK(target_database ~ '^nasq_scratch_[a-f0-9]{32}$'),
  source_binding jsonb NOT NULL,
  runtime_scope text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER shared_odoo_restore_targets_permanent BEFORE UPDATE OR DELETE ON shared_odoo_restore_targets
  FOR EACH ROW EXECUTE FUNCTION shared_backup_append_only();
CREATE FUNCTION shared_odoo_restore_registry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM shared_odoo_restore_targets WHERE target_database IN (NEW.database_name,NEW.filestore))
  THEN RAISE EXCEPTION 'restore target permanently reserved'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER shared_odoo_restore_registry_guard BEFORE INSERT OR UPDATE ON shared_registry_bindings
  FOR EACH ROW EXECUTE FUNCTION shared_odoo_restore_registry_guard();
