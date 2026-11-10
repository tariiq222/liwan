import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { SharedReconfigureJob } from '@liwan/commercial-contracts/shared'
import { enqueueReconfigureJob } from '../shared/job-store.js'

/**
 * What a delivery to a tenant needs from the subscription's applied revision: the row, the registry binding and an order.
 * `newest` (the default, used by the expiry push) is the latest order of the revision, applied or not. `applied` is the
 * order that actually applied the revision, never a newer unapplied one such as an outstanding renewal: an AI push is
 * authorised by the applied revision, so nothing pending may affect it.
 */
export async function appliedDeliveryTarget(client: Pick<PoolClient, 'query'>, subscription_id: string, order: 'newest' | 'applied' = 'newest') {
  const row = (await client.query(`SELECT s.*,r.snapshot
    FROM subscriptions s JOIN subscription_revisions r ON r.id=s.applied_revision_id
    WHERE s.id=$1`, [subscription_id])).rows[0] as Record<string, any> | undefined
  if (!row) return null
  const binding = (await client.query('SELECT * FROM shared_registry_bindings WHERE control_tenant_id=$1 AND enabled=true', [row.tenant_id])).rows[0] as Record<string, any> | undefined
  const found = (await client.query(`SELECT id,fulfillment_state FROM orders WHERE subscription_id=$1 AND target_revision_id=$2${order === 'applied' ? " AND fulfillment_state='applied'" : ''} ORDER BY created_at DESC,id DESC LIMIT 1`, [subscription_id, row.applied_revision_id])).rows[0] as { id: string; fulfillment_state: string } | undefined
  return { row, binding, order: found }
}

/**
 * Re-delivers the applied revision. `aiPush` marks a job that changes only the derived AI keys (see `pushAiEntitlement`). Callers pass the entitlement through `deliveredEntitlement`, so the live AI keys
 * ride along on every delivery that is not a fulfilment (an expiry change, a ledger change).
 * `unique` gives the job a business key of its own: a ledger state can recur (5, 10, 5), so it must never be swallowed
 * as a replay of an earlier, already verified push.
 */
export async function enqueueAppliedDelivery(client: PoolClient, target: NonNullable<Awaited<ReturnType<typeof appliedDeliveryTarget>>> & { binding: Record<string, any>; order: { id: string } },
  entitlement: { modules: unknown; features: Record<string, unknown>; digest: string; compiler_version: unknown },
  expiry: Pick<SharedReconfigureJob['authority'], 'commercial_valid_until' | 'commercial_valid_until_revision' |
    'trial_ends_at' | 'post_trial_features' | 'post_trial_modules' | 'post_trial_digest'> | null,
  unique: boolean, aiPush = false, origin?: SharedReconfigureJob['origin']) {
  const { row, binding, order } = target
  const operation_id = randomUUID()
  await enqueueReconfigureJob(client, { schemaVersion: 1, operation: 'reconfigure', requestId: operation_id,
    controlTenantId: row.tenant_id, ...(origin ? { origin } : {}), host: binding.host,
    binding: { tenantId: binding.tenant_id, database: binding.database_name, filestore: binding.filestore, registryRevision: Number(binding.registry_revision) },
    authority: { order_id: order.id, operation_id, previous_revision_id: row.applied_revision_id, target_revision_id: row.applied_revision_id,
      entitlement,
      branches: { apply: [], archive: [] }, ...expiry, ...(aiPush ? { ai_push: true as const } : {}) } }, { unique })
}
