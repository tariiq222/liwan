-- A suspended subscription must stop the tenant's users, so the control plane pushes the tenant's Odoo status.
-- tenant_status_pushed is the status last confirmed written to Odoo; the worker converges it to the state.
-- manual_suspension marks a vendor-ordered suspension: a payment does not lift it, only a vendor resume does.
ALTER TABLE subscriptions
  ADD COLUMN tenant_status_pushed text NOT NULL DEFAULT 'active' CHECK (tenant_status_pushed IN ('active','suspended')),
  ADD COLUMN manual_suspension boolean NOT NULL DEFAULT false;
CREATE INDEX subscriptions_tenant_status_pending ON subscriptions(id)
  WHERE tenant_id IS NOT NULL AND tenant_status_pushed <> CASE WHEN state='suspended' THEN 'suspended' ELSE 'active' END;
