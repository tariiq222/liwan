-- Automatic renewal on a stored payment method (issue 492). The customer's explicit consent to keep the method is
-- recorded on the hosted attempt that asks for it, with who gave it; the token itself never leaves
-- subscriptions.provider_token_ref and token_revocations.
ALTER TABLE payment_attempts
  ADD COLUMN save_payment_method boolean NOT NULL DEFAULT false,
  ADD COLUMN save_payment_method_actor text,
  ADD COLUMN save_payment_method_consent_at timestamptz,
  -- A token charge's callback, kept so that replaying an unconfirmed charge sends exactly what the first call sent.
  ADD COLUMN charge_callback_url text,
  ADD CONSTRAINT payment_attempt_save_consent CHECK(NOT save_payment_method OR (save_payment_method_actor IS NOT NULL AND save_payment_method_consent_at IS NOT NULL));

-- A stored payment method the provider still has to forget: written in the same transaction that stopped using it
-- (the customer turned auto-renew off, or a new method replaced it), deleted only once the provider confirmed. A process
-- that dies in between leaves the row for the worker, so a revocation is retried, never lost.
CREATE TABLE token_revocations (
  id uuid PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES subscriptions(id),
  provider text NOT NULL,
  token text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX token_revocations_due ON token_revocations(next_attempt_at);
