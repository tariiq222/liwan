-- No runtime setup producer exists before this migration. Refuse unexpected
-- method data rather than manufacturing activation or revocation history.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM payment_methods) THEN
    RAISE EXCEPTION 'stored_payment_method_history_requires_review';
  END IF;
END $$;

ALTER TABLE payment_methods
  ADD COLUMN setup_expires_at timestamptz,
  ADD COLUMN activated_at timestamptz,
  ADD COLUMN closed_reason text CHECK (closed_reason IN ('setup_expired','setup_cancelled','setup_failed','invalid','revoked')),
  ADD COLUMN revoke_attempts integer NOT NULL DEFAULT 0 CHECK (revoke_attempts >= 0),
  ADD COLUMN revoke_next_at timestamptz,
  ADD CONSTRAINT payment_method_lifecycle_shape CHECK (
    (state='setup')=(setup_expires_at IS NOT NULL)
    AND (state='closed')=(closed_reason IS NOT NULL)
    AND (state='revoking')=(revoke_next_at IS NOT NULL)
    AND (state NOT IN ('active','revoking') OR activated_at IS NOT NULL)
    AND (state<>'setup' OR activated_at IS NULL)
  );
CREATE INDEX payment_methods_due_revocation ON payment_methods(revoke_next_at,id) WHERE state='revoking';
