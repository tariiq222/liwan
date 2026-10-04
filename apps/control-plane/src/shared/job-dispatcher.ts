import type { Pool } from 'pg'
import { commercialProvisionAuthoritySql } from './commercial-enrollment-authority.js'
import { expireSharedLeases, runSharedJob, type SharedFencedAdapter } from './job-worker.js'

/** Single scheduler tick. Selecting an ID is not claiming it: runSharedJob owns
 * the row lock, tenant exclusion and current authorization checks. No production
 * adapter is provided here; dedicated worker-main remains unchanged. */
export async function dispatchSharedOnce(pool: Pool, adapter?: SharedFencedAdapter) {
  if (!adapter) throw new Error('shared_adapter_unavailable')
  await expireSharedLeases(pool)
  const next = await pool.query(`SELECT queued.id FROM shared_jobs queued
    JOIN tenants tenant ON tenant.id=queued.control_tenant_id
    JOIN shared_registry_bindings binding ON binding.control_tenant_id=queued.control_tenant_id
    WHERE queued.state='queued' AND tenant.commercial_mode='saas'
    AND tenant.operations_enabled=true AND (binding.enabled=true OR EXISTS (
      SELECT 1 FROM shared_onboardings onboarding WHERE onboarding.control_tenant_id=queued.control_tenant_id
      AND onboarding.job_id=queued.id AND onboarding.job_digest=queued.payload_digest
      AND onboarding.request_id::text=queued.payload->>'requestId' AND onboarding.stage='queued'
      AND queued.payload->>'operation'='provision'
    ))
    AND NOT (queued.payload->>'operation'='restore' AND queued.journal->>'stage'='waiting_commercial_reconcile' AND EXISTS (
      SELECT 1 FROM shared_jobs reconf WHERE reconf.control_tenant_id=queued.control_tenant_id
      AND reconf.payload->>'operation'='reconfigure' AND reconf.state IN ('queued','running')
    ))
    AND ((queued.payload->>'operation' IN ('provision','backup','restore')
    AND queued.payload->'binding'=jsonb_build_object(
      'tenantId',binding.tenant_id,'database',binding.database_name,
      'filestore',binding.filestore,'registryRevision',binding.registry_revision
    )
    AND (EXISTS (
      SELECT 1 FROM vendor_memberships membership
      WHERE membership.issuer=queued.issuer AND membership.actor_uid=queued.actor_uid
      AND membership.revoked_at IS NULL
      AND 'vendor.operations.run'=ANY(membership.capabilities)
    ) OR (${commercialProvisionAuthoritySql()}))) OR (queued.payload->>'operation'='reconfigure' AND (queued.payload->'binding'=jsonb_build_object(
      'tenantId',binding.tenant_id,'database',binding.database_name,
      'filestore',binding.filestore,'registryRevision',binding.registry_revision
    ) OR queued.payload->>'restore'='true'))) AND NOT EXISTS (
      SELECT 1 FROM shared_jobs unresolved
      WHERE unresolved.control_tenant_id=queued.control_tenant_id
      AND unresolved.state IN ('running','needs_intervention')
    ) ORDER BY queued.created_at,queued.id LIMIT 1`)
  if (!next.rows.length) return { state: 'idle' }
  try { return await runSharedJob(pool, next.rows[0].id, adapter) }
  catch (error) {
    // A concurrent dispatcher may have claimed the candidate after selection.
    if (error instanceof Error && ['shared_job_not_claimable','shared_reconciliation_required'].includes(error.message)) return { state: 'contended' }
    throw error
  }
}
