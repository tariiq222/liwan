-- hosting_model states the tenant's hosting lane: shared_managed | dedicated_managed | customer_hosted.
-- The old `managed` value is split. Back-fill rule: a managed tenant is `shared_managed` when it has a
-- shared-lane row (shared_onboardings, written by self-service onboarding, or shared_registry_bindings, written by
-- the registry publisher); every other `managed` tenant ran on a dedicated inventory target, so it becomes
-- `dedicated_managed`. `customer_hosted` rows are unchanged.
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_hosting_model_check;
UPDATE tenants t SET hosting_model = CASE
  WHEN EXISTS (SELECT 1 FROM shared_onboardings o WHERE o.control_tenant_id = t.id)
    OR EXISTS (SELECT 1 FROM shared_registry_bindings b WHERE b.control_tenant_id = t.id) THEN 'shared_managed'
  ELSE 'dedicated_managed'
END WHERE t.hosting_model = 'managed';
ALTER TABLE tenants ADD CONSTRAINT tenants_hosting_model_check
  CHECK (hosting_model IN ('shared_managed','dedicated_managed','customer_hosted'));
