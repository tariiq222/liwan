-- Tenant storage drop: the deletion removes the tenant's own bucket, objects, keys and IAM user before the database goes
-- (tools/shared_saas_lifecycle/tenant_storage_effect.py). A row with operation 'drop' is never claimed by the storage loop, so no
-- `ensure` can create what the drop is removing; its state follows the effect's answer (`emptying` while a large bucket drains, then
-- `removed`). In the fixed policy mode the shared policy and group serve other tenants and stay.
ALTER TABLE tenant_storage DROP CONSTRAINT tenant_storage_operation_check;
ALTER TABLE tenant_storage DROP CONSTRAINT tenant_storage_state_check;
ALTER TABLE tenant_storage DROP CONSTRAINT tenant_storage_stage_check;
ALTER TABLE tenant_storage
  ADD CONSTRAINT tenant_storage_operation_check CHECK(operation IN ('ensure','verify','rotate','drop')),
  ADD CONSTRAINT tenant_storage_state_check CHECK(state IN ('queued','pending_key','active','failed','emptying','removed')),
  ADD CONSTRAINT tenant_storage_stage_check CHECK(stage IN ('key_stored','verified','objects_removed','resources_removed'));

-- The deletion's own step that removes that storage, before `drop_database`.
ALTER TABLE tenant_deletion_steps DROP CONSTRAINT tenant_deletion_steps_step_check;
ALTER TABLE tenant_deletion_steps
  ADD CONSTRAINT tenant_deletion_steps_step_check CHECK(step IN ('preflight','stop_access','unbind_relay','commit','delete_cards','remove_storage','drop_database',
    'remove_filestore','remove_restore_copies','purge_local_backups','purge_offsite','remove_side_files','clean_registry_rows','finish','anonymise_contacts','reinstate'));
