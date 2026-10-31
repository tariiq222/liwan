-- A suspended subscription must stop the tenant's users, so the control plane pushes the tenant's Odoo status.
-- tenant_status_pushed is the status last confirmed written to Odoo; NULL means unknown (after a restore or a
-- provision) and is asserted again by the worker. A failing push backs off through tenant_status_failures and
-- tenant_status_next_at so it cannot starve other tenants.
-- manual_suspension marks a vendor-ordered suspension: a payment does not lift it, only a vendor resume does.
ALTER TABLE subscriptions
  ADD COLUMN tenant_status_pushed text DEFAULT 'active' CHECK (tenant_status_pushed IN ('active','suspended')),
  ADD COLUMN tenant_status_failures integer NOT NULL DEFAULT 0 CHECK (tenant_status_failures >= 0),
  ADD COLUMN tenant_status_next_at timestamptz,
  ADD COLUMN manual_suspension boolean NOT NULL DEFAULT false;
CREATE INDEX subscriptions_tenant_status_pending ON subscriptions(id)
  WHERE tenant_id IS NOT NULL AND tenant_status_pushed IS DISTINCT FROM CASE WHEN state='suspended' THEN 'suspended' ELSE 'active' END;

-- Push bookkeeping is not a commercial change: it must not move the revision a quote was priced against.
CREATE OR REPLACE FUNCTION subscription_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.customer_id<>OLD.customer_id THEN RAISE EXCEPTION 'subscription_identity_immutable'; END IF;
  IF (to_jsonb(NEW)-'revision'-'tenant_status_pushed'-'tenant_status_failures'-'tenant_status_next_at')
     IS DISTINCT FROM (to_jsonb(OLD)-'revision'-'tenant_status_pushed'-'tenant_status_failures'-'tenant_status_next_at') THEN
    IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'subscription_revision_conflict'; END IF;
  ELSIF NEW.revision<>OLD.revision THEN RAISE EXCEPTION 'subscription_revision_conflict';
  END IF;
  RETURN NEW;
END $$;
