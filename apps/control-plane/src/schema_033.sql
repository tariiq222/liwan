-- Vendor-editable billing settings the code must not hardcode: one row, changed from the vendor console.
-- refund_window_days (W7): a full refund is allowed only within this many days of the customer's first payment and
-- only for that payment; renewals and later payments are never refundable. Release 1: 14 days (owner 2026-11-06).
-- onboarding_fee_minor (W6): the one-time assisted onboarding on a first invoice, 499 at release (owner 2026-11-06).
-- The bank account below is where a customer transfers; empty means bank transfer is not offered yet.
CREATE TABLE billing_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  refund_window_days integer NOT NULL CHECK (refund_window_days BETWEEN 0 AND 365),
  refund_method text NOT NULL DEFAULT 'manual' CHECK (refund_method = 'manual'),
  -- The optional one-time assisted onboarding (a month with a staff member) on a first invoice; 0 offers none.
  onboarding_fee_minor bigint NOT NULL DEFAULT 0 CHECK (onboarding_fee_minor >= 0),
  onboarding_currency text NOT NULL DEFAULT 'SAR' CHECK (onboarding_currency ~ '^[A-Z]{3}$'),
  onboarding_exponent integer NOT NULL DEFAULT 2 CHECK (onboarding_exponent BETWEEN 0 AND 4),
  bank_account_name text NOT NULL DEFAULT '',
  bank_account_number text NOT NULL DEFAULT '',
  bank_iban text NOT NULL DEFAULT '',
  bank_instructions_ar text NOT NULL DEFAULT '',
  bank_instructions_en text NOT NULL DEFAULT '',
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(bank_iban) = 0 OR bank_iban ~ '^SA[0-9]{22}$')
);
INSERT INTO billing_settings(singleton, refund_window_days, onboarding_fee_minor, updated_by) VALUES (true, 14, 49900, 'schema_033');

-- Bank transfer is a payment provider: the vendor records the transfer as received and the order is paid through the
-- same path a Moyasar success uses. The provider constrains itself; no adapter calls out for it.
ALTER TABLE payment_attempts DROP CONSTRAINT IF EXISTS payment_attempts_provider_check;
ALTER TABLE payment_attempts ADD CONSTRAINT payment_attempts_provider_check
  CHECK (provider IN ('moyasar','simulator','bank_transfer'));
ALTER TABLE payment_events DROP CONSTRAINT IF EXISTS payment_events_provider_check;
ALTER TABLE payment_events ADD CONSTRAINT payment_events_provider_check
  CHECK (provider IN ('moyasar','simulator','bank_transfer'));

-- A recorded transfer: the operator's reference is unique per provider (the reference index above covers it), and the
-- value date is the day the money reached the account, which may precede the day the vendor recorded it.
ALTER TABLE payment_attempts ADD COLUMN value_date date;
ALTER TABLE payment_attempts ADD CONSTRAINT payment_attempts_value_date_only_transfer
  CHECK (value_date IS NULL OR provider = 'bank_transfer');
