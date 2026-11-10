CREATE TABLE trial_lapses (
  subscription_id uuid PRIMARY KEY REFERENCES subscriptions(id),
  trial_revision_id uuid NOT NULL REFERENCES subscription_revisions(id),
  period_start date NOT NULL,
  lapsed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz NOT NULL,
  kept jsonb,
  force_empty boolean NOT NULL DEFAULT false,
  customer_retry_at timestamptz,
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
ALTER TABLE subscriptions ADD COLUMN renewal_failure text, ADD COLUMN renewal_failed_at timestamptz,
  ADD COLUMN suspended_from text CHECK (suspended_from IN ('active','past_due','trialing')),
  ADD COLUMN trial_outcome text CHECK (trial_outcome IN ('converted','kept_subset','free_base')),
  ADD COLUMN trial_paid_through jsonb, ADD COLUMN trial_ended_at timestamptz;
ALTER TABLE tenants ADD COLUMN post_trial_supported boolean, ADD COLUMN excess_supported boolean;
ALTER TABLE commercial_branches ADD COLUMN read_only boolean NOT NULL DEFAULT false;
UPDATE subscriptions SET suspended_from='trialing',revision=revision+1
  WHERE state='suspended' AND manual_suspension AND trial_ends_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM renewals WHERE subscription_id=subscriptions.id);

CREATE UNIQUE INDEX shared_jobs_trial_end_open ON shared_jobs(control_tenant_id)
  WHERE payload->>'origin'='trial-end' AND state IN ('queued','running','needs_intervention');
ALTER TABLE shared_jobs ADD COLUMN recovery_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN recovery_at timestamptz;
ALTER TABLE orders ADD COLUMN fulfillment_retries integer NOT NULL DEFAULT 0,
  ADD COLUMN automatic_refund boolean NOT NULL DEFAULT false, ADD COLUMN fulfillment_retry_at timestamptz, ADD COLUMN fulfillment_failure_code text;

ALTER TABLE subscriptions ADD COLUMN suspension_pending_since timestamptz;


CREATE FUNCTION track_suspension_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  wanted text := CASE WHEN NEW.state='suspended' OR NEW.manual_suspension THEN 'suspended' ELSE 'active' END;
  previous text := CASE WHEN OLD.state='suspended' OR OLD.manual_suspension THEN 'suspended' ELSE 'active' END;
BEGIN
  IF wanted <> previous THEN
    NEW.tenant_status_failures := 0;
    NEW.tenant_status_next_at := NULL;
  END IF;
  IF wanted='suspended' AND NEW.tenant_status_pushed IS DISTINCT FROM 'suspended' THEN
    NEW.suspension_pending_since := COALESCE(OLD.suspension_pending_since,now());
  ELSE
    NEW.suspension_pending_since := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION subscription_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.customer_id<>OLD.customer_id THEN RAISE EXCEPTION 'subscription_identity_immutable'; END IF;
  IF (to_jsonb(NEW)-'revision'-'tenant_status_pushed'-'tenant_status_failures'-'tenant_status_next_at'-'billing_blocked_at'-'renewal_failure'-'renewal_failed_at'-'suspension_pending_since')
     IS DISTINCT FROM (to_jsonb(OLD)-'revision'-'tenant_status_pushed'-'tenant_status_failures'-'tenant_status_next_at'-'billing_blocked_at'-'renewal_failure'-'renewal_failed_at'-'suspension_pending_since') THEN
    IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'subscription_revision_conflict'; END IF;
  ELSIF NEW.revision<>OLD.revision THEN RAISE EXCEPTION 'subscription_revision_conflict';
  END IF;
  RETURN NEW;
END $$;

UPDATE subscriptions SET suspension_pending_since=now()
  WHERE (state='suspended' OR manual_suspension) AND tenant_status_pushed IS DISTINCT FROM 'suspended';

CREATE TRIGGER a_track_suspension_delivery BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION track_suspension_delivery();
