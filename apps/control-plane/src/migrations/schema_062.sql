-- A payment made straight with the public key can carry any description and callback, and both of an attempt's are derivable from its id.
-- So the callback of each intent also carries a random secret that only the payer's browser is given by the provider's redirect, and a
-- payment settles an attempt only when its callback holds this attempt's current secret. A new intent gets a new secret.
-- `declined_payment_ref` is the payment of the current intent that the provider reported as failed: it is what lets a declined attempt open
-- a fresh intent at once, because a consumed intent without it may still hold a payment nobody has seen.
ALTER TABLE payment_attempts
  ADD COLUMN callback_secret text,
  ADD COLUMN declined_payment_ref text,
  ADD CONSTRAINT payment_attempts_callback_secret_check CHECK (callback_secret IS NULL OR (provider_intent_ref IS NOT NULL AND length(callback_secret) >= 32)),
  ADD CONSTRAINT payment_attempts_declined_check CHECK (declined_payment_ref IS NULL OR provider_intent_ref IS NOT NULL);

-- Rejected card form payments are audit events looked up by payment id (to answer a repeated one without asking the provider again).
CREATE INDEX audit_events_form_rejection ON audit_events ((metadata->>'payment_id'), action) WHERE action IN ('payment.form_hint_rejected', 'payment.form_payment_rejected');

-- A removed card keeps no token once the provider has deleted it (or the deletion was given up); an active card always has one.
ALTER TABLE payment_methods
  ALTER COLUMN provider_token DROP NOT NULL,
  DROP CONSTRAINT payment_methods_provider_token_check,
  ADD CONSTRAINT payment_methods_token_present_check CHECK (status = 'removed' OR (provider_token IS NOT NULL AND length(provider_token) > 0));
