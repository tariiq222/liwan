import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { AI_ENTITLEMENT_KEYS, AI_UNITS_MAX, aiEntitlementFeatures, quoteSchema, sarMinorToAiUnits, type AiBillingSettings } from '@liwan/commercial-contracts'
import { transaction } from '../db.js'
import { lockTenantJobs } from '../shared/job-store.js'
import { appliedDeliveryTarget, enqueueAppliedDelivery } from './delivery-target.js'

type Q = Pick<Pool, 'query'>

/** The vendor-wide AI billing settings (one row). */
export async function aiBillingSettings(db: Q): Promise<AiBillingSettings> {
  const row = (await db.query('SELECT topup_amounts_minor,topup_minimum_minor,usd_rate,trial_allowance_minor,monthly_allowance_minor FROM ai_billing_settings WHERE singleton')).rows[0]
  if (!row) throw new Error('ai_billing_settings_missing')
  return { topup_amounts_minor: (row.topup_amounts_minor as unknown[]).map(Number), topup_minimum_minor: Number(row.topup_minimum_minor),
    usd_rate: String(row.usd_rate), trial_allowance_minor: Number(row.trial_allowance_minor), monthly_allowance_minor: Number(row.monthly_allowance_minor) }
}

/** The customer's cumulative granted total: every top-up not refunded, in AI cost units. */
export async function grantedUnits(db: Q, customerId: string): Promise<number> {
  const r = await db.query('SELECT COALESCE(sum(units),0)::text AS total FROM ai_topups WHERE customer_id=$1 AND refunded_at IS NULL', [customerId])
  return Number(r.rows[0].total)
}

/**
 * The three AI keys a tenant receives, computed from the live ledger and settings at the moment of delivery. They are
 * deliberately not part of the subscription snapshot: a snapshot is immutable and is re-delivered by renewals and
 * plan changes, so a value frozen in it would go stale (a later top-up) or regress the total. A ledger at or over the
 * cap (a product decision still open) is delivered clamped and logged, never thrown: delivery must not stop.
 */
export async function liveAiFeatures(client: Q, customerId: string): Promise<Record<string, number>> {
  const settings = await aiBillingSettings(client)
  const total = await grantedUnits(client, customerId)
  if (total > AI_UNITS_MAX) console.error(`[ai-ledger] customer ${customerId} holds ${total} granted units; delivering the cap ${AI_UNITS_MAX}`)
  return aiEntitlementFeatures({ granted_units: Math.min(total, AI_UNITS_MAX),
    trial_units: sarMinorToAiUnits(settings.trial_allowance_minor, settings.usd_rate), monthly_units: sarMinorToAiUnits(settings.monthly_allowance_minor, settings.usd_rate) })
}

/**
 * The snapshot's entitlement as the tenant receives it: the live AI keys replace whatever the snapshot carries.
 * A shared job's identity digest is taken over `JSON.stringify` of the job and re-taken after a jsonb round trip, which
 * returns keys shortest first, then bytewise. The features are therefore emitted in that order so both digests agree.
 */
export async function deliveredEntitlement<E extends { features: Record<string, unknown> }>(client: Q, customerId: string, entitlement: E): Promise<E> {
  const merged = { ...entitlement.features, ...await liveAiFeatures(client, customerId) }
  const ordered = Object.entries(merged).sort(([a], [b]) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
  return { ...entitlement, features: Object.fromEntries(ordered) }
}

/**
 * Queues an AI-only push (`ai_push`) of the live AI keys to the customer's tenant, authorised by the order that applied
 * its current revision. Returns false only when there is nothing to push to (no tenant, applied revision, binding or
 * applying order). Every job reads the live values when it is claimed, so one queued, dispatchable push is always
 * enough: if one already exists for this binding and revision, none is added. The tenant lock is taken before anything
 * is read, the same lock a claim and a completion take, so a ledger event and a worker cannot miss each other.
 */
export async function pushAiEntitlement(client: PoolClient, customerId: string): Promise<boolean> {
  const subscription = (await client.query('SELECT id,tenant_id FROM subscriptions WHERE customer_id=$1', [customerId])).rows[0]
  if (!subscription?.tenant_id) return false
  await lockTenantJobs(client, subscription.tenant_id)
  const target = await appliedDeliveryTarget(client, subscription.id, 'applied')
  if (!target?.binding || !target.order) return false
  const { binding } = target
  const queued = await client.query(`SELECT 1 FROM shared_jobs WHERE control_tenant_id=$1 AND state='queued' AND payload->'authority'->>'ai_push'='true'
    AND payload->'authority'->>'target_revision_id'=$2
    AND payload->'binding'=jsonb_build_object('tenantId',$3::text,'database',$4::text,'filestore',$5::text,'registryRevision',$6::bigint)`,
  [subscription.tenant_id, target.row.applied_revision_id, binding.tenant_id, binding.database_name, binding.filestore, binding.registry_revision])
  if (queued.rowCount) return true
  const { snapshot } = target.row
  const entitlement = await deliveredEntitlement(client, customerId, { modules: snapshot.entitlement.modules, features: snapshot.entitlement.features,
    digest: snapshot.entitlement.digest, compiler_version: snapshot.entitlement.compiler_version })
  await enqueueAppliedDelivery(client, { ...target, binding, order: target.order }, entitlement, null, true, true)
  return true
}

/** The one comparison: whether the three AI values a tenant holds (or was just sent) equal the customer's live ones. */
export async function aiValuesCurrent(client: Q, customerId: string, held: Record<string, unknown>): Promise<boolean> {
  return aiDifferences(await liveAiFeatures(client, customerId), held).length === 0
}
const aiDifferences = (live: Record<string, number>, held: Record<string, unknown>) => Object.keys(live).filter(key => held[key] !== live[key])

/**
 * After a delivery: the values it carried are compared with the live ones, read under the tenant lock, and a push
 * follows when they differ. Equal values queue nothing, so a push's own completion ends the chain.
 */
export async function pushAiIfStale(client: PoolClient, customerId: string, delivered: Record<string, unknown>): Promise<boolean> {
  const tenant = (await client.query('SELECT tenant_id FROM subscriptions WHERE customer_id=$1', [customerId])).rows[0]?.tenant_id
  if (!tenant) return false
  await lockTenantJobs(client, tenant)
  return !await aiValuesCurrent(client, customerId, delivered) && await pushAiEntitlement(client, customerId)
}

/**
 * The level-triggered sweep, run by the usage collector for each tenant it observed: what the tenant holds is compared
 * with the live ledger (under the tenant lock and the unchanged-binding check) and a push is queued when they differ.
 * A correction here means an event path missed a change, so it is logged with the tenant and the keys, nothing else.
 */
export async function sweepAi(pool: Pool, target: { tenant_id: string; database_name: string; registry_revision: string }, held: Record<string, number>, log: (message: string) => void): Promise<boolean> {
  return transaction(pool, async client => {
    await lockTenantJobs(client, target.tenant_id)
    const bound = await client.query('SELECT 1 FROM shared_registry_bindings WHERE control_tenant_id=$1 AND enabled=true AND database_name=$2 AND registry_revision=$3',
      [target.tenant_id, target.database_name, target.registry_revision])
    const customer = (await client.query('SELECT customer_id FROM subscriptions WHERE tenant_id=$1', [target.tenant_id])).rows[0]?.customer_id
    if (!bound.rowCount || !customer) return false
    const differing = aiDifferences(await liveAiFeatures(client, customer), held)
    if (!differing.length) return false
    log(`AI values of tenant ${target.tenant_id} differed from the ledger (${differing.join(', ')}); queued a correction`)
    return pushAiEntitlement(client, customer)
  })
}

export type TopupRecord = 'none' | 'recorded' | 'over_cap'

/**
 * Called when an order's payment settles, inside the settlement transaction and before fulfilment is queued. Records
 * the top-up of the order's quote, once (the order id is unique, so a repeated event adds nothing), at the units and
 * rate the quote showed. The customer row is locked so two payments cannot both pass the cap check. An order that
 * would take the lifetime total over the cap is not recorded: the caller sends it down the failed-fulfilment path.
 */
export async function recordPaidTopup(client: PoolClient, order: { id: string; customer_id: string; quote_id: string }): Promise<TopupRecord> {
  const payload = (await client.query('SELECT payload FROM commercial_quotes WHERE id=$1', [order.quote_id])).rows[0]?.payload
  const line = payload ? quoteSchema.parse(payload).lines.find(l => l.kind === 'ai_topup') : undefined
  if (!line?.ai_topup) return 'none'
  await client.query('SELECT id FROM customers WHERE id=$1 FOR UPDATE', [order.customer_id])
  if ((await client.query('SELECT 1 FROM ai_topups WHERE order_id=$1', [order.id])).rowCount) return 'recorded'
  if (await grantedUnits(client, order.customer_id) + line.ai_topup.units > AI_UNITS_MAX) return 'over_cap'
  await client.query('INSERT INTO ai_topups(id,customer_id,order_id,amount_minor,currency,usd_rate,units) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [randomUUID(), order.customer_id, order.id, line.amount.minor, line.amount.currency, line.ai_topup.usd_rate, line.ai_topup.units])
  return 'recorded'
}

/**
 * Lowers the ledger for a top-up that is refunded however the refund happens (vendor action, generic invoice refund,
 * provider refund, failed fulfilment). Idempotent. The tenant may hold the units whatever state the purchase's own
 * fulfilment is in, so a push is queued regardless of it.
 */
export async function markTopupRefunded(client: PoolClient, orderId: string, by: string, reason: string): Promise<boolean> {
  const row = (await client.query(`UPDATE ai_topups t SET refunded_at=now(),refunded_by=$2,refund_reason=$3 FROM orders o
    WHERE t.order_id=$1 AND o.id=t.order_id AND t.refunded_at IS NULL RETURNING t.customer_id`, [orderId, by, reason])).rows[0]
  if (!row) return false
  await pushAiEntitlement(client, row.customer_id)
  return true
}
