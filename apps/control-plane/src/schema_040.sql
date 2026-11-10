-- Automatic renewal on a stored payment method (issue 492). The customer's explicit consent to keep the method is
-- recorded on the hosted attempt that asks for it; the token itself never leaves subscriptions.provider_token_ref.
ALTER TABLE payment_attempts
  ADD COLUMN save_payment_method boolean NOT NULL DEFAULT false,
  ADD COLUMN save_payment_method_consent_at timestamptz,
  ADD CONSTRAINT payment_attempt_save_consent CHECK(NOT save_payment_method OR save_payment_method_consent_at IS NOT NULL);
