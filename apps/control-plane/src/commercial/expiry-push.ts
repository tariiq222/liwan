import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { trialAuthority } from './fulfillment.js'
import { CommercialHttpError } from './lifecycle.js'
import { enqueueReconfigureJob } from '../shared/job-store.js'

/** Push the trial's Odoo hard expiry on every trial-date mutation, not only at fulfilment. */
export async function pushCommercialExpiry(client: PoolClient, subscription_id: string, value: string | Date | null) {
  const row = (await client.query(`SELECT s.*,r.snapshot
    FROM subscriptions s JOIN subscription_revisions r ON r.id=s.applied_revision_id
    WHERE s.id=$1`, [subscription_id])).rows[0]
  if (!row?.applied_revision_id) return
  const binding = (await client.query('SELECT * FROM shared_registry_bindings WHERE control_tenant_id=$1 AND enabled=true', [row.tenant_id])).rows[0]
  if (!binding) throw new CommercialHttpError('tenant_binding_unavailable', 409)
  const order = (await client.query("SELECT id,fulfillment_state FROM orders WHERE subscription_id=$1 AND target_revision_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1", [subscription_id, row.applied_revision_id])).rows[0]
  // A queued/applying order will push the current trial date itself when it applies; refusing here
  // would break an extension issued during enrolment, and bumping the revision with no job would
  // leave a gap with no recorded request.
  if (order && order.fulfillment_state !== 'applied') return
  if (!order) throw new CommercialHttpError('trial_order_unavailable', 409)
  const revision = Number(row.commercial_expiry_revision) + 1
  await client.query('UPDATE subscriptions SET commercial_expiry_revision=$2,revision=revision+1 WHERE id=$1', [subscription_id, revision])
  const operation_id = randomUUID()
  const policy = value ? await trialAuthority(client, row, row.snapshot, new Date(value)) : { trial_ends_at: null }
  await enqueueReconfigureJob(client, { schemaVersion: 1, operation: 'reconfigure', requestId: operation_id,
    controlTenantId: row.tenant_id, origin: 'trial-end', host: binding.host,
    binding: { tenantId: binding.tenant_id, database: binding.database_name, filestore: binding.filestore, registryRevision: Number(binding.registry_revision) },
    authority: { order_id: order.id, operation_id, previous_revision_id: row.applied_revision_id, target_revision_id: row.applied_revision_id,
      entitlement: { modules: row.snapshot.entitlement.modules, features: row.snapshot.entitlement.features,
        digest: row.snapshot.entitlement.digest, compiler_version: row.snapshot.entitlement.compiler_version },
      branches: { apply: [], archive: [] }, ...policy, commercial_valid_until: null, commercial_valid_until_revision: revision } })
}
