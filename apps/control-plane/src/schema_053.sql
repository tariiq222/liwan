-- The suspension reason last confirmed written to Odoo, beside tenant_status_pushed. A tenant stopped for non-payment
-- stays readable in Odoo, a vendor suspension does not, so a change of reason is a change to push even when the status
-- stays 'suspended' (a vendor suspends, resumes before the push lands, and dunning suspends again).
ALTER TABLE subscriptions ADD COLUMN tenant_suspension_reason_pushed text CHECK (tenant_suspension_reason_pushed IN ('non_payment','vendor'));

CREATE OR REPLACE FUNCTION subscription_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.customer_id<>OLD.customer_id THEN RAISE EXCEPTION 'subscription_identity_immutable'; END IF;
  IF (to_jsonb(NEW)-'revision'-'tenant_status_pushed'-'tenant_suspension_reason_pushed'-'tenant_status_failures'-'tenant_status_next_at'-'billing_blocked_at'-'renewal_failure'-'renewal_failed_at'-'suspension_pending_since')
     IS DISTINCT FROM (to_jsonb(OLD)-'revision'-'tenant_status_pushed'-'tenant_suspension_reason_pushed'-'tenant_status_failures'-'tenant_status_next_at'-'billing_blocked_at'-'renewal_failure'-'renewal_failed_at'-'suspension_pending_since') THEN
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
  IF wanted='suspended' AND (NEW.tenant_status_pushed IS DISTINCT FROM 'suspended' OR NEW.tenant_suspension_reason_pushed IS DISTINCT FROM wanted_reason) THEN
    NEW.suspension_pending_since := COALESCE(OLD.suspension_pending_since,now());
  ELSE
    NEW.suspension_pending_since := NULL;
  END IF;
  RETURN NEW;
END $$;

-- Odoo learned no reason before this column: a vendor suspension already pushed is a full lockout there, which is right;
-- a non-payment suspension is pushed again so Odoo keeps it readable.
UPDATE subscriptions SET tenant_suspension_reason_pushed='vendor' WHERE tenant_status_pushed='suspended' AND manual_suspension;
