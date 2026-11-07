-- Vendor-editable billing settings the code must not hardcode: one row, changed from the vendor console.
-- refund_window_days (W7): a full refund is allowed only within this many days of the customer's first payment and
-- only for that payment; renewals and later payments are never refundable. Release 1: 14 days (owner 2026-11-06).
-- onboarding_fee_minor (W6): the one-time assisted onboarding on a first invoice, 499 at release (owner 2026-11-06).
-- The bank account below is where a customer transfers; empty means bank transfer is not offered yet.
CREATE TABLE billing_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  refund_window_days integer NOT NULL CHECK (refund_window_days BETWEEN 0 AND 365),
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

-- A recorded transfer: the operator's reference is unique per provider (the reference index above covers it), and the
-- value date is the day the money reached the account, which may precede the day the vendor recorded it.
ALTER TABLE payment_attempts ADD COLUMN value_date date;

-- A5: who a credit note came from. `vendor` is a refund the vendor records because the customer asked for it, and only
-- those carry the first-payment/window rule; `system` notes (duplicate charge, payment after cancellation, fulfilment
-- failure) keep the plain path. An explicit column, never inferred from the free-text created_by.
ALTER TABLE invoice_adjustments ADD COLUMN origin text NOT NULL DEFAULT 'vendor' CHECK (origin IN ('vendor','system'));
-- One refunded note per invoice: a second refund of the same invoice is refused.
CREATE UNIQUE INDEX invoice_adjustments_one_refund ON invoice_adjustments(invoice_id) WHERE status = 'refunded';

-- A5: the immutable moment a payment succeeded, written once. `updated_at` cannot carry it: reconciliation and sibling
-- cancellation touch it, which would slide the refund window and could change which payment was the customer's first.
ALTER TABLE payment_attempts ADD COLUMN succeeded_at timestamptz;
UPDATE payment_attempts SET succeeded_at = updated_at WHERE status = 'succeeded' AND succeeded_at IS NULL;
CREATE INDEX payment_attempts_succeeded_at ON payment_attempts(order_id, succeeded_at) WHERE succeeded_at IS NOT NULL;
ALTER TABLE payment_attempts ADD CONSTRAINT payment_attempts_value_date_only_transfer
  CHECK (value_date IS NULL OR provider = 'bank_transfer');
