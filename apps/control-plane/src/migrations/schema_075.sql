-- Who approved a restore. Until now only the audit event named the approver; the row carries it so a rule that needs a
-- second person to approve can read it later. The label is the one audit spelling of the actor (`account:<id>`). A row
-- approved before this column existed has no recorded approver and stays NULL: the audit event holds it, and the row
-- cannot be updated once consumed.
ALTER TABLE shared_restore_approvals ADD COLUMN approved_by text;

-- The approver, like the rest of the approval's identity, never changes after the row exists.
CREATE OR REPLACE FUNCTION shared_restore_approval_consumed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'restore approval already consumed'; END IF;
  IF NEW.backup_id IS DISTINCT FROM OLD.backup_id OR NEW.control_tenant_id IS DISTINCT FROM OLD.control_tenant_id
     OR NEW.target_database IS DISTINCT FROM OLD.target_database OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
    RAISE EXCEPTION 'restore approval identity is immutable';
  END IF;
  RETURN NEW;
END; $$;
