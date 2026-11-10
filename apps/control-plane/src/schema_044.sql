-- A trial that lapses onto the free base (issue 491) is two steps. The lapse itself (state, hard expiry cleared in Odoo)
-- always happens at once, so the trial's expiry can never lock a tenant. Locking the paid applications is a retried step with
-- an explicit state: why it has not happened yet is `reason`, and a lapse with a reason is what the vendor attention list
-- shows. The lock keeps every numeric limit; what the customer holds above the included quantities stays with them (owner
-- decision 2026-11-10) and is never lowered automatically, so `done` is the end of the lapse.
CREATE TABLE trial_lapses (
  subscription_id uuid PRIMARY KEY REFERENCES subscriptions(id),
  trial_revision_id uuid NOT NULL REFERENCES subscription_revisions(id),
  period_start date NOT NULL,
  lapsed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ordered','done','superseded')),
  order_id uuid REFERENCES orders(id),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  -- Orders issued so far, never reset: the order key is derived from it, so a retry can never meet an old key.
  order_seq integer NOT NULL DEFAULT 0 CHECK(order_seq >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason text,
  CHECK(state <> 'ordered' OR order_id IS NOT NULL)
);
CREATE INDEX trial_lapses_due ON trial_lapses(next_attempt_at) WHERE state IN ('pending','ordered');

-- A renewal that fails for one subscription (a poisoned snapshot, a missing pinned policy) is isolated from the others and
-- recorded here; the vendor attention list shows it until a renewal is generated for the subscription.
ALTER TABLE subscriptions ADD COLUMN renewal_failure text, ADD COLUMN renewal_failed_at timestamptz;

-- Like the block marker, the failure marker is bookkeeping, not a commercial change: it must not move the revision a quote was priced against.
CREATE OR REPLACE FUNCTION subscription_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.customer_id<>OLD.customer_id THEN RAISE EXCEPTION 'subscription_identity_immutable'; END IF;
  IF (to_jsonb(NEW)-'revision'-'tenant_status_pushed'-'tenant_status_failures'-'tenant_status_next_at'-'billing_blocked_at'-'renewal_failure'-'renewal_failed_at')
     IS DISTINCT FROM (to_jsonb(OLD)-'revision'-'tenant_status_pushed'-'tenant_status_failures'-'tenant_status_next_at'-'billing_blocked_at'-'renewal_failure'-'renewal_failed_at') THEN
    IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'subscription_revision_conflict'; END IF;
  ELSIF NEW.revision<>OLD.revision THEN RAISE EXCEPTION 'subscription_revision_conflict';
  END IF;
  RETURN NEW;
END $$;
