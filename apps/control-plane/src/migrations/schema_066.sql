-- The final deletion of a tenant's workspace. A confirmed request becomes `due` when the 90 day window ends and then holds for
-- TENANT_DELETION_HOLD_HOURS (`hold_until`), during which the workspace still works and the request can still be withdrawn. At the end of the hold a
-- runner (one at a time per request, by `lease_until` and `fence`) freezes a plan (`deleting`), stops access, and at `committed_at` (the point of
-- no return) carries out the deletion step by step (`tenant_deletion_steps`). `deleted` is final. All times are the database clock.
ALTER TABLE tenant_deletion_requests
  DROP CONSTRAINT tenant_deletion_requests_state_check,
  DROP CONSTRAINT tenant_deletion_requests_window_check,
  DROP CONSTRAINT tenant_deletion_requests_due_check;
ALTER TABLE tenant_deletion_requests
  ADD COLUMN hold_until timestamptz,
  ADD COLUMN deleting_at timestamptz,
  ADD COLUMN committed_at timestamptz,
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN plan jsonb,
  ADD COLUMN plan_digest text,
  ADD COLUMN lease_until timestamptz,
  ADD COLUMN fence bigint NOT NULL DEFAULT 0,
  ADD COLUMN stuck_at timestamptz,
  ADD COLUMN stuck_code text;
-- A request that was already `due` when the hold was introduced gets a hold from now, as a due request owes its customer the same last chance.
UPDATE tenant_deletion_requests SET hold_until = now() + interval '72 hours' WHERE state = 'due';
ALTER TABLE tenant_deletion_requests
  ADD CONSTRAINT tenant_deletion_requests_state_check CHECK (state IN ('requested','confirmed','due','deleting','deleted','withdrawn')),
  ADD CONSTRAINT tenant_deletion_requests_window_check CHECK (state NOT IN ('confirmed','due','deleting','deleted') OR (confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL AND due_at IS NOT NULL)),
  ADD CONSTRAINT tenant_deletion_requests_due_check CHECK (state NOT IN ('due','deleting','deleted') OR (due_marked_at IS NOT NULL AND hold_until IS NOT NULL)),
  ADD CONSTRAINT tenant_deletion_requests_run_check CHECK ((state NOT IN ('deleting','deleted') OR (deleting_at IS NOT NULL AND plan IS NOT NULL AND plan_digest ~ '^[a-f0-9]{64}$'))
    AND ((state = 'deleted') = (deleted_at IS NOT NULL))
    AND (committed_at IS NULL OR state IN ('deleting','deleted'))
    AND (state <> 'deleted' OR committed_at IS NOT NULL)
    AND ((stuck_at IS NULL) = (stuck_code IS NULL)) AND (stuck_code IS NULL OR stuck_code ~ '^[a-z0-9_:]{1,100}$'));
DROP INDEX tenant_deletion_requests_open;
CREATE UNIQUE INDEX tenant_deletion_requests_open ON tenant_deletion_requests (customer_id) WHERE state IN ('requested','confirmed','due','deleting');
CREATE INDEX tenant_deletion_requests_runnable ON tenant_deletion_requests (hold_until) WHERE state IN ('due','deleting');
-- A request that was withdrawn before the point of no return after its access was stopped still has work: the runner reinstates the workspace.
CREATE INDEX tenant_deletion_requests_reinstate ON tenant_deletion_requests (id) WHERE state = 'withdrawn' AND plan IS NOT NULL AND committed_at IS NULL;

-- One row per step of one request: what it intended, how often it ran and failed, what it observed (names and counts only, never a secret).
CREATE TABLE tenant_deletion_steps (
  request_id uuid NOT NULL REFERENCES tenant_deletion_requests(id),
  step text NOT NULL CHECK (step IN ('preflight','stop_access','unbind_relay','commit','delete_cards','drop_database','remove_filestore','remove_restore_copies',
    'purge_local_backups','purge_offsite','remove_side_files','clean_registry_rows','finish','anonymise_contacts','reinstate')),
  state text NOT NULL CHECK (state IN ('pending','running','done','failed','skipped')),
  intent text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  started_at timestamptz,
  finished_at timestamptz,
  next_attempt_at timestamptz,
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9_]{1,64}$'),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (request_id, step)
);

ALTER TABLE tenants DROP CONSTRAINT tenants_status_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_status_check CHECK (status IN ('registered','provisioning','active','needs_intervention','deleting','deleted'));

-- A retired tenant is one whose workspace is being or has been deleted. Only the deletion authority publishes this flag; a retired binding is never enabled.
ALTER TABLE shared_registry_bindings ADD COLUMN retired boolean NOT NULL DEFAULT false, ADD CONSTRAINT shared_registry_bindings_retired_check CHECK (NOT (retired AND enabled));

-- Where a restored control plane records that it was restored from a backup (singleton row, written by the restore procedure): no deletion commits
-- until `restored_at` plus the hold has passed, so a restored database cannot replay a deletion whose customer withdrew in the lost interval.
CREATE TABLE control_plane_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  restored_at timestamptz
);
INSERT INTO control_plane_state(singleton) VALUES (true);

-- No new shared job, restore approval or restore publication for a tenant whose customer is deleting or deleted.
CREATE FUNCTION tenant_retiring_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenant_deletion_requests r JOIN customers c ON c.id = r.customer_id
      WHERE c.tenant_id = NEW.control_tenant_id AND r.state IN ('deleting','deleted')) THEN
    RAISE EXCEPTION 'tenant_retiring' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER shared_jobs_tenant_retiring BEFORE INSERT ON shared_jobs FOR EACH ROW EXECUTE FUNCTION tenant_retiring_guard();
CREATE TRIGGER shared_restore_approvals_tenant_retiring BEFORE INSERT ON shared_restore_approvals FOR EACH ROW EXECUTE FUNCTION tenant_retiring_guard();
CREATE TRIGGER shared_restore_publications_tenant_retiring BEFORE INSERT ON shared_restore_publications FOR EACH ROW EXECUTE FUNCTION tenant_retiring_guard();

-- Backup records stay permanent, but the manifest and the artifact path of a retired tenant's backup are purged (and stamped) once its deletion is committed.
ALTER TABLE shared_backups ADD COLUMN purged_at timestamptz, ALTER COLUMN artifact_path DROP NOT NULL,
  ADD CONSTRAINT shared_backups_purged_check CHECK ((purged_at IS NULL) = (artifact_path IS NOT NULL));
CREATE FUNCTION shared_backup_purge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'backup records are permanent'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL AND NEW.artifact_path IS NULL AND NEW.snapshot = '{}'::jsonb
       AND (to_jsonb(NEW) - 'purged_at' - 'artifact_path' - 'snapshot') = (to_jsonb(OLD) - 'purged_at' - 'artifact_path' - 'snapshot')
       AND EXISTS (SELECT 1 FROM tenant_deletion_requests r JOIN customers c ON c.id = r.customer_id
         WHERE c.tenant_id = OLD.control_tenant_id AND r.state IN ('deleting','deleted') AND r.committed_at IS NOT NULL) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'backup records are append only';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER shared_backups_immutable ON shared_backups;
CREATE TRIGGER shared_backups_immutable BEFORE UPDATE OR DELETE ON shared_backups FOR EACH ROW EXECUTE FUNCTION shared_backup_purge_guard();

-- The administrator's name and login are removed from the records once the workspace is gone and the final mail is closed.
ALTER TABLE shared_onboardings ALTER COLUMN admin_name DROP NOT NULL, ALTER COLUMN admin_login DROP NOT NULL;
ALTER TABLE admin_invitations ALTER COLUMN admin_login DROP NOT NULL;
