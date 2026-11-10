-- The former inline sender did not record a durable charge claim or encrypted
-- consent. Refuse to reinterpret its records. No old credentials are logged.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM payment_attempts WHERE token_charge)
     OR EXISTS (SELECT 1 FROM subscriptions WHERE auto_renew_enabled
       OR auto_renew_consent_at IS NOT NULL OR provider_token_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'legacy_stored_payment_requires_reconciliation';
  END IF;
END $$;

CREATE TABLE payment_methods (
  id uuid PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES subscriptions(id),
  provider text NOT NULL CHECK (provider IN ('moyasar','simulator')),
  state text NOT NULL CHECK (state IN ('setup','active','revoking','closed')),
  token_ciphertext bytea,
  key_id text,
  consent_at timestamptz NOT NULL,
  consent_actor text NOT NULL CHECK (length(consent_actor)>0),
  consent_version text NOT NULL CHECK (length(consent_version)>0),
  CHECK (CASE WHEN state IN ('active','revoking')
    THEN token_ciphertext IS NOT NULL AND octet_length(token_ciphertext)>0 AND key_id IS NOT NULL AND length(key_id)>0
    ELSE token_ciphertext IS NULL AND key_id IS NULL END)
);
CREATE UNIQUE INDEX payment_methods_one_open ON payment_methods(subscription_id) WHERE state IN ('setup','active');

ALTER TABLE subscriptions DROP COLUMN auto_renew_enabled, DROP COLUMN auto_renew_consent_at, DROP COLUMN provider_token_ref;
ALTER TABLE payment_attempts
  ADD COLUMN method_id uuid REFERENCES payment_methods(id),
  ADD COLUMN sent_at timestamptz,
  ADD COLUMN resolved_at timestamptz,
  ADD COLUMN closed_reason text,
  ADD CONSTRAINT payment_attempts_stored_charge_shape CHECK (CASE WHEN token_charge THEN
    method_id IS NOT NULL AND redirect_url IS NULL AND CASE status
      WHEN 'created' THEN sent_at IS NULL AND resolved_at IS NULL AND closed_reason IS NULL AND provider_ref IS NULL
      WHEN 'unknown' THEN sent_at IS NOT NULL AND resolved_at IS NULL AND closed_reason IS NULL AND provider_ref IS NULL
      WHEN 'pending' THEN sent_at IS NOT NULL AND resolved_at IS NULL AND closed_reason IS NULL AND provider_ref IS NOT NULL
      WHEN 'succeeded' THEN sent_at IS NOT NULL AND resolved_at IS NOT NULL AND closed_reason IS NULL AND provider_ref IS NOT NULL
      WHEN 'failed' THEN sent_at IS NOT NULL AND resolved_at IS NOT NULL AND closed_reason IS NOT DISTINCT FROM 'declined'
      WHEN 'canceled' THEN resolved_at IS NOT NULL AND closed_reason IS NOT NULL AND (
        closed_reason='superseded'
        OR (sent_at IS NULL AND closed_reason IN ('token_inactive','method_off','unsent_expired'))
        OR (sent_at IS NOT NULL AND closed_reason IN ('refused','abandoned','provider_closed'))
      )
      ELSE false END
    ELSE method_id IS NULL AND sent_at IS NULL AND resolved_at IS NULL AND closed_reason IS NULL END);
CREATE UNIQUE INDEX payment_attempts_one_stored_charge ON payment_attempts(invoice_id) WHERE token_charge;
