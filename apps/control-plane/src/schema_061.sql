-- A card payment through the embedded form is one payment attempt with one provider intent. The intent is the server-locked amount,
-- currency, description and callback the browser may only fulfil; its id is kept so the attempt can read it back (a payment carries no
-- intent id) and cancel it. `save_card` is what the customer asked and consented to: the browser can tamper with its own request, so
-- the row, not the browser, decides whether the card is kept. The check keeps a card from ever being saved without its consent record.
ALTER TABLE payment_attempts
  ADD COLUMN provider_intent_ref text,
  ADD COLUMN save_card boolean NOT NULL DEFAULT false,
  ADD COLUMN consent_at timestamptz,
  ADD COLUMN consent_text_version text,
  ADD CONSTRAINT payment_attempts_save_card_consent_check CHECK (NOT save_card OR (consent_at IS NOT NULL AND length(consent_text_version) > 0)),
  ADD CONSTRAINT payment_attempts_intent_form_check CHECK (provider_intent_ref IS NULL OR kind = 'form');
CREATE UNIQUE INDEX payment_attempts_intent_ref ON payment_attempts (provider, provider_intent_ref) WHERE provider_intent_ref IS NOT NULL;
