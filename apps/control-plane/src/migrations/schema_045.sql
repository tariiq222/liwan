-- A vendor can reopen a trial after voiding its first invoice. Keep that
-- renewal's history while permitting a new payable renewal for the same day.
ALTER TABLE renewals DROP CONSTRAINT renewals_status_check;
ALTER TABLE renewals ADD CONSTRAINT renewals_status_check
  CHECK(status IN ('invoiced','charging','paid','past_due','suspended','failed','superseded'));
ALTER TABLE renewals DROP CONSTRAINT renewals_subscription_id_period_start_kind_key;
CREATE UNIQUE INDEX renewals_current_period ON renewals(subscription_id, period_start, kind)
  WHERE status <> 'superseded';
