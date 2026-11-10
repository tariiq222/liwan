-- A trial that lapses onto the free base (issue 491) is two steps. The lapse itself (state, hard expiry cleared in Odoo)
-- always happens at once, so the trial's expiry can never lock a tenant. Lowering the entitlement to the base is a
-- retried step with an explicit state: why it has not happened yet is `reason`, and a lapse with a reason is what the
-- vendor attention list shows. `limits_pending` is the settled over-limit state: the paid applications are already
-- locked and only some limits wait for usage to fit.
CREATE TABLE trial_lapses (
  subscription_id uuid PRIMARY KEY REFERENCES subscriptions(id),
  trial_revision_id uuid NOT NULL REFERENCES subscription_revisions(id),
  period_start date NOT NULL,
  lapsed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ordered','limits_pending','done','superseded')),
  -- The order in flight keeps some limit at current usage because usage exceeds the free value (or could not be judged).
  partial boolean NOT NULL DEFAULT false,
  -- What exceeds the free limits (machine text, e.g. users.limit:4>3); shown to the vendor while the limits wait.
  limits_note text,
  -- The order in flight lowers the limits of a base that is already applied (not the first lowering).
  from_limits boolean NOT NULL DEFAULT false,
  order_id uuid REFERENCES orders(id),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason text,
  CHECK(state <> 'ordered' OR order_id IS NOT NULL)
);
CREATE INDEX trial_lapses_due ON trial_lapses(next_attempt_at) WHERE state IN ('pending','ordered','limits_pending');
