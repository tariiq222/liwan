-- Vendor-editable billing settings the code must not hardcode: one row, changed from the vendor console.
-- A full refund is allowed only within `refund_window_days` of the customer's first payment, and only for that
-- payment; renewals and later payments are never refundable. Release 1: 14 days (owner decision 2026-11-06).
CREATE TABLE billing_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  refund_window_days integer NOT NULL CHECK (refund_window_days BETWEEN 0 AND 365),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO billing_settings(singleton, refund_window_days, updated_by) VALUES (true, 14, 'schema_033');
