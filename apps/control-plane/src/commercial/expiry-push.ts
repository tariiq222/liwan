import type { PoolClient } from 'pg'
import { CommercialHttpError } from './lifecycle.js'
import { trialAuthority } from './fulfillment.js'
import { appliedDeliveryTarget, enqueueAppliedDelivery } from './delivery-target.js'
import { deliveredEntitlement } from './ai-ledger.js'

/** Update the tenant's trial deadline, or its older commercial expiry during rollout. */
export async function pushCommercialExpiry(client: PoolClient, subscriptionId: string, value: string | Date | null) {
  const target = await appliedDeliveryTarget(client, subscriptionId)
  if (!target) return
  const { row, binding, order } = target
  if (!binding) throw new CommercialHttpError('tenant_binding_unavailable', 409)
  if (order && order.fulfillment_state !== 'applied') return
  if (!order) throw new CommercialHttpError('trial_order_unavailable', 409)
  const revision = Number(row.commercial_expiry_revision) + 1
  const legacy = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  const policy = legacy ? {} : value ? await trialAuthority(client, row, row.snapshot, new Date(value)) : { trial_ends_at: null }
  const entitlement = await deliveredEntitlement(client, row.customer_id, { modules: row.snapshot.entitlement.modules,
    features: row.snapshot.entitlement.features, digest: row.snapshot.entitlement.digest, compiler_version: row.snapshot.entitlement.compiler_version })
  // A queued date-only push can be superseded without sending it. A running one remains fenced.
  await client.query(`UPDATE shared_jobs SET state='failed',lease_until=NULL
    WHERE control_tenant_id=$1 AND state='queued' AND payload->>'origin'='trial-end'
    AND payload->'authority'->>'order_id'=$2 AND payload->'authority'->>'excess_settle' IS DISTINCT FROM 'true'`, [row.tenant_id, order.id])
  await client.query('UPDATE subscriptions SET commercial_expiry_revision=$2,revision=revision+1 WHERE id=$1', [subscriptionId, revision])
  await enqueueAppliedDelivery(client, { ...target, binding, order }, entitlement,
    { ...policy, commercial_valid_until: legacy ? value : null, commercial_valid_until_revision: revision }, true, false, legacy ? undefined : 'trial-end')
}
