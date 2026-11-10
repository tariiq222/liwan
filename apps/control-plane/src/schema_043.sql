-- AI balance top-ups (spec 2026-11-10-liwan-ai-plans-and-router-design, 5.3). A top-up is a one-time line of an order;
-- the ledger is the single source of the customer's cumulative granted total (sum of the non-refunded rows), so the
-- delivered `ai.balance.granted` is always recomputable. The vendor-wide settings are not plan fields: a renewal
-- reuses the pinned plan revision, and they must change for every tenant at once.
CREATE TABLE ai_billing_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  -- SAR minor units, ascending; every one reaches the minimum.
  topup_amounts_minor integer[] NOT NULL CHECK (cardinality(topup_amounts_minor) BETWEEN 1 AND 12),
  topup_minimum_minor integer NOT NULL CHECK (topup_minimum_minor > 0),
  -- SAR per USD, exact decimal.
  usd_rate numeric(10,6) NOT NULL CHECK (usd_rate > 0),
  trial_allowance_minor integer NOT NULL CHECK (trial_allowance_minor >= 0),
  monthly_allowance_minor integer NOT NULL CHECK (monthly_allowance_minor >= 0),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ai_billing_settings(singleton, topup_amounts_minor, topup_minimum_minor, usd_rate, trial_allowance_minor, monthly_allowance_minor, updated_by)
VALUES (true, '{2500,5000,10000,25000,50000}', 2500, 3.75, 500, 0, 'schema_043');

CREATE TABLE ai_topups (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  -- One row per paid order: a repeated payment event cannot grant twice.
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency = 'SAR'),
  -- The rate in force when the payment settled, and the AI cost units it bought at that rate.
  usd_rate numeric(10,6) NOT NULL CHECK (usd_rate > 0),
  units bigint NOT NULL CHECK (units >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  refunded_at timestamptz,
  refunded_by text,
  refund_reason text,
  CHECK ((refunded_at IS NULL) = (refunded_by IS NULL) AND (refunded_at IS NULL) = (refund_reason IS NULL))
);
CREATE INDEX ai_topups_customer ON ai_topups(customer_id);
