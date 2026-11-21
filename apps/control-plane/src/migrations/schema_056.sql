-- A tenant cancels its own paid subscription: the renewal stops, the paid period stays, and at the period end the
-- subscription drops to the free base through the free-base lock. The request is an explicit fact on the subscription
-- (revisioned like every other column by subscription_revision_guard): who asked, when, and why when a vendor asked on
-- the customer's behalf. The effective date is the subscription's own renewal_at, never a copy of it.
ALTER TABLE subscriptions
  ADD COLUMN cancel_requested_at timestamptz,
  ADD COLUMN cancel_requested_by text CHECK (cancel_requested_by IN ('customer','vendor')),
  ADD COLUMN cancel_reason text,
  ADD CONSTRAINT subscriptions_cancel_request_check CHECK ((cancel_requested_at IS NULL) = (cancel_requested_by IS NULL)
    AND (cancel_requested_at IS NOT NULL OR cancel_reason IS NULL));

-- The free-base lock gains the cancellation cause. Like a refund it has no trial end.
ALTER TABLE free_base_locks DROP CONSTRAINT free_base_locks_cause_check, DROP CONSTRAINT free_base_locks_trial_ended_check;
ALTER TABLE free_base_locks
  ADD CONSTRAINT free_base_locks_cause_check CHECK (cause IN ('trial_end','first_invoice_unpaid','refund','cancelled')),
  ADD CONSTRAINT free_base_locks_trial_ended_check CHECK (cause IN ('refund','cancelled') OR trial_ended_at IS NOT NULL);

-- The lock row is rewritten for every cause, so what an earlier lock excluded from revenue history must outlive the rewrite:
-- a cancelled lock keeps the earlier trial-end or refund cutoff here (NULL when nothing was excluded before).
ALTER TABLE free_base_locks ADD COLUMN excluded_until timestamptz;
