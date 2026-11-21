-- The trial-end lock becomes the free-base lock: one machine that drops a subscription to the free base, armed by the
-- trial end, by an unpaid first post-trial invoice, or by the vendor recording the refund of the customer's first payment.
ALTER TABLE trial_lapses RENAME TO free_base_locks;
ALTER TABLE free_base_locks RENAME CONSTRAINT trial_lapses_pkey TO free_base_locks_pkey;
ALTER TABLE free_base_locks RENAME CONSTRAINT trial_lapses_subscription_id_fkey TO free_base_locks_subscription_id_fkey;
ALTER TABLE free_base_locks RENAME CONSTRAINT trial_lapses_trial_revision_id_fkey TO free_base_locks_pre_lock_revision_id_fkey;
ALTER TABLE free_base_locks RENAME CONSTRAINT trial_lapses_order_id_fkey TO free_base_locks_order_id_fkey;
ALTER TABLE free_base_locks RENAME CONSTRAINT trial_lapses_state_check TO free_base_locks_state_check;
ALTER TABLE free_base_locks RENAME CONSTRAINT trial_lapses_attempts_check TO free_base_locks_attempts_check;
ALTER TABLE free_base_locks RENAME CONSTRAINT trial_lapses_order_seq_check TO free_base_locks_order_seq_check;
ALTER TABLE free_base_locks RENAME CONSTRAINT trial_lapses_check TO free_base_locks_ordered_check;
ALTER INDEX trial_lapses_due RENAME TO free_base_locks_due;
ALTER TABLE free_base_locks RENAME COLUMN lapsed_at TO armed_at;
ALTER TABLE free_base_locks RENAME COLUMN ended_at TO trial_ended_at;
ALTER TABLE free_base_locks RENAME COLUMN trial_revision_id TO pre_lock_revision_id;
ALTER TABLE free_base_locks ALTER COLUMN trial_ended_at DROP NOT NULL;
ALTER TABLE free_base_locks ADD COLUMN cause text;
UPDATE free_base_locks SET cause=CASE WHEN force_empty THEN 'first_invoice_unpaid' ELSE 'trial_end' END;
ALTER TABLE free_base_locks ALTER COLUMN cause SET NOT NULL,
  ADD CONSTRAINT free_base_locks_cause_check CHECK (cause IN ('trial_end','first_invoice_unpaid','refund')),
  ADD CONSTRAINT free_base_locks_trial_ended_check CHECK (cause='refund' OR trial_ended_at IS NOT NULL),
  DROP COLUMN force_empty;
-- Carry development data to the new names: the lock orders' key prefix (the order guard keeps keys immutable, so it is
-- lifted for this one rewrite) and the lock notices still waiting in the outbox.
ALTER TABLE orders DISABLE TRIGGER order_payment_guard;
UPDATE orders SET idempotency_key='free-base-lock:'||substr(idempotency_key,length('trial-lapse:')+1) WHERE idempotency_key LIKE 'trial-lapse:%';
ALTER TABLE orders ENABLE TRIGGER order_payment_guard;
UPDATE commercial_outbox SET kind='free_base.locked',
  payload=(payload-'force_empty')||jsonb_build_object('cause',CASE WHEN payload->>'force_empty'='true' THEN 'first_invoice_unpaid' ELSE 'trial_end' END)
  WHERE kind='trial.over_limit';
