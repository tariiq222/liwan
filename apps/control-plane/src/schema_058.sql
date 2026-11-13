-- A payment attempt has a kind, which says what the provider reference identifies: a hosted invoice (looked up as an invoice), a
-- payment made through the embedded card form, or a charge of a saved card (both looked up as a payment). This replaces the
-- token_charge flag, which could not say "direct payment, not a saved card".
ALTER TABLE payment_attempts ADD COLUMN kind text NOT NULL DEFAULT 'hosted_invoice'
  CONSTRAINT payment_attempts_kind_check CHECK (kind IN ('hosted_invoice','form','saved_card'));
UPDATE payment_attempts SET kind = 'saved_card' WHERE token_charge;
ALTER TABLE payment_attempts DROP COLUMN token_charge;

-- The embedded form's own bookkeeping: the provider-side intent reference, whether the customer asked to keep the card, the consent
-- that was shown (its time and the version of its text), and the provider's failure code. Saving a card needs a recorded consent.
ALTER TABLE payment_attempts
  ADD COLUMN provider_intent_ref text,
  ADD COLUMN save_card boolean NOT NULL DEFAULT false,
  ADD COLUMN consent_at timestamptz,
  ADD COLUMN consent_text_version text,
  ADD COLUMN failure_code text,
  ADD CONSTRAINT payment_attempts_save_card_consent_check CHECK (NOT save_card OR (consent_at IS NOT NULL AND consent_text_version IS NOT NULL));

-- A saved card: the provider's opaque token and the display facts the provider returned (brand, last four digits, expiry). Never a card
-- number, a security code or a holder name. The customer's default active row is the one a renewal charges.
CREATE TABLE payment_methods (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  provider text NOT NULL CHECK (provider IN ('moyasar','simulator')),
  mode text NOT NULL CHECK (mode IN ('test','live','simulator')),
  provider_token text NOT NULL CHECK (length(provider_token) > 0),
  brand text NOT NULL CHECK (length(brand) > 0),
  last_four text NOT NULL CHECK (last_four ~ '^[0-9]{4}$'),
  exp_month integer NOT NULL CHECK (exp_month BETWEEN 1 AND 12),
  exp_year integer NOT NULL CHECK (exp_year BETWEEN 2000 AND 2999),
  funding text,
  status text NOT NULL CHECK (status IN ('active','inactive','removed')),
  is_default boolean NOT NULL DEFAULT false,
  consent_at timestamptz NOT NULL,
  consent_text_version text NOT NULL,
  source_attempt_id uuid REFERENCES payment_attempts(id),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  removed_by text,
  CONSTRAINT payment_methods_removed_check CHECK ((status = 'removed') = (removed_at IS NOT NULL AND removed_by IS NOT NULL)),
  CONSTRAINT payment_methods_token_unique UNIQUE (provider, mode, provider_token)
);
CREATE INDEX payment_methods_customer ON payment_methods (customer_id);
-- At most one default active method per customer.
CREATE UNIQUE INDEX payment_methods_one_default ON payment_methods (customer_id) WHERE is_default AND status = 'active';

-- The subscription no longer carries the token: it is the customer's default active payment method. The table check that auto-renew
-- needs consent (auto_renew_enabled requires auto_renew_consent_at) does not mention the column and stays; subscription_revision_guard
-- compares whole rows through to_jsonb, so it needs no change.
ALTER TABLE subscriptions DROP COLUMN provider_token_ref;
