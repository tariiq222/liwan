-- Phase 1 cannot create stored attempts through a runtime entry point.
-- Preserve any unexpected financial evidence rather than inventing delivery.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM payment_attempts WHERE token_charge) THEN
    RAISE EXCEPTION 'stored_payment_notice_backfill_required';
  END IF;
END $$;

ALTER TABLE payment_methods ADD CONSTRAINT payment_methods_notice_owner UNIQUE (id, subscription_id);
CREATE TABLE renewal_notices (
  id uuid PRIMARY KEY,
  subscription_id uuid NOT NULL,
  method_id uuid NOT NULL,
  renewal_date date NOT NULL,
  cadence_unit text NOT NULL CHECK (cadence_unit IN ('month','year')),
  cadence_count integer NOT NULL CHECK (cadence_count BETWEEN 1 AND 12),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  exponent integer NOT NULL CHECK (exponent BETWEEN 0 AND 9),
  state text NOT NULL DEFAULT 'due' CHECK (state IN ('due','sent','void')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  void_reason text CHECK (void_reason IN ('late','method_closed','off','amount_changed')),
  CHECK ((state='sent')=(sent_at IS NOT NULL) AND (state='void')=(void_reason IS NOT NULL)),
  FOREIGN KEY (method_id, subscription_id) REFERENCES payment_methods(id, subscription_id),
  UNIQUE (id, method_id),
  UNIQUE (method_id, renewal_date, amount_minor, currency, exponent, cadence_unit, cadence_count)
);
CREATE INDEX renewal_notices_due ON renewal_notices(renewal_date,next_attempt_at) WHERE state='due';

ALTER TABLE payment_attempts
  ADD COLUMN notice_id uuid,
  ADD CONSTRAINT payment_attempts_notice_method FOREIGN KEY (notice_id,method_id) REFERENCES renewal_notices(id,method_id),
  ADD CONSTRAINT payment_attempts_notice_required CHECK (token_charge=(notice_id IS NOT NULL));
