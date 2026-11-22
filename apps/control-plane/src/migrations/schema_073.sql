-- A tenant status that Odoo has not confirmed is pending in both directions: a resume that never reached the workspace leaves
-- it stopped while the subscription is active, and the vendor needs the same clock for it as for a suspension that never arrived.
-- The clock therefore no longer belongs to suspensions only.
ALTER TABLE subscriptions RENAME COLUMN suspension_pending_since TO tenant_status_pending_since;

CREATE OR REPLACE FUNCTION subscription_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.customer_id<>OLD.customer_id THEN RAISE EXCEPTION 'subscription_identity_immutable'; END IF;
  IF (to_jsonb(NEW)-'revision'-'tenant_status_pushed'-'tenant_suspension_reason_pushed'-'tenant_status_failures'-'tenant_status_next_at'-'billing_blocked_at'-'renewal_failure'-'renewal_failed_at'-'tenant_status_pending_since')
     IS DISTINCT FROM (to_jsonb(OLD)-'revision'-'tenant_status_pushed'-'tenant_suspension_reason_pushed'-'tenant_status_failures'-'tenant_status_next_at'-'billing_blocked_at'-'renewal_failure'-'renewal_failed_at'-'tenant_status_pending_since') THEN
    IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'subscription_revision_conflict'; END IF;
  ELSIF NEW.revision<>OLD.revision THEN RAISE EXCEPTION 'subscription_revision_conflict';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION track_suspension_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  wanted text := CASE WHEN NEW.state='suspended' OR NEW.manual_suspension THEN 'suspended' ELSE 'active' END;
  previous text := CASE WHEN OLD.state='suspended' OR OLD.manual_suspension THEN 'suspended' ELSE 'active' END;
  wanted_reason text := CASE WHEN NEW.manual_suspension THEN 'vendor' WHEN NEW.state='suspended' THEN 'non_payment' END;
  previous_reason text := CASE WHEN OLD.manual_suspension THEN 'vendor' WHEN OLD.state='suspended' THEN 'non_payment' END;
BEGIN
  IF wanted <> previous OR wanted_reason IS DISTINCT FROM previous_reason THEN
    NEW.tenant_status_failures := 0;
    NEW.tenant_status_next_at := NULL;
  END IF;
  IF NEW.tenant_status_pushed IS DISTINCT FROM wanted OR NEW.tenant_suspension_reason_pushed IS DISTINCT FROM wanted_reason THEN
    NEW.tenant_status_pending_since := COALESCE(OLD.tenant_status_pending_since,now());
  ELSE
    NEW.tenant_status_pending_since := NULL;
  END IF;
  RETURN NEW;
END $$;

-- A resume already waiting when this ran has no clock yet: it starts now.
UPDATE subscriptions SET tenant_status_pending_since=now()
  WHERE NOT (state='suspended' OR manual_suspension) AND tenant_status_pushed='suspended' AND tenant_status_pending_since IS NULL;
