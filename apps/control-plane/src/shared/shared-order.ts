// Package-6 order and sandbox payment lifecycle. An order carries an
// immutable quote snapshot (prices/taxes/currency are PRODUCT decisions that
// must be set before any real provider integration; the sandbox uses
// synthetic values supplied by the caller). Confirmation comes only from the
// sandbox provider function; a provider event is applied exactly once per
// event id; a paid order triggers exactly one provision job enqueue; a paid
// order whose tenant is not active reports 'paid_not_ready' instead of
// success. Cancelled/failed payments never provision.
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { z } from 'zod'
import { transaction } from '../db.js'
import { enqueueSharedJob } from './job-store.js'

export const quoteSchema = z.strictObject({
  schemaVersion: z.literal(1),
  currency: z.string().length(3),
  billingCycle: z.enum(['monthly', 'yearly']),
  priceMinorUnits: z.number().int().positive(),
  taxMinorUnits: z.number().int().nonnegative(),
  catalogVersion: z.string().min(1).max(100),
  catalogTier: z.string().min(1).max(100),
})
export type Quote = z.infer<typeof quoteSchema>

export type SandboxPaymentResult = { status: 'succeeded' | 'failed' | 'canceled'; eventId: string }

export async function createSharedOrder(pool: Pool, input: { controlTenantId: string; idempotencyKey: string; quote: unknown }): Promise<{ orderId: string; replay: boolean }> {
  z.uuid().parse(input.controlTenantId)
  z.string().min(8).max(200).parse(input.idempotencyKey)
  const quote = quoteSchema.parse(input.quote)
  return transaction(pool, async client => {
    const existing = await client.query('SELECT id FROM shared_orders WHERE idempotency_key=$1', [input.idempotencyKey])
    if (existing.rowCount) return { orderId: existing.rows[0].id as string, replay: true }
    const tenant = await client.query("SELECT id FROM tenants WHERE id=$1 AND commercial_mode='saas'", [input.controlTenantId])
    if (!tenant.rowCount) throw new Error('order_tenant_unavailable')
    const orderId = randomUUID()
    await client.query("INSERT INTO shared_orders(id,control_tenant_id,idempotency_key,quote,status) VALUES($1,$2,$3,$4,'pending')", [orderId, input.controlTenantId, input.idempotencyKey, quote])
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), 'order-api', 'shared_order.created', orderId, 'Order created with an immutable quote', { idempotencyKey: input.idempotencyKey }])
    return { orderId, replay: false }
  })
}

/** The sandbox provider. One provider event id is applied exactly once; the
 * same idempotency key retries the same logical attempt rather than creating
 * a second charge record. This models the provider contract without touching
 * any real payment network. */
export async function applyPaymentEvent(pool: Pool, input: { orderId: string; providerEvent: { eventId: string; kind: 'payment_intent.succeeded' | 'payment_intent.payment_failed' | 'payment_intent.canceled' } }): Promise<{ status: string; firstSeen: boolean }> {
  z.uuid().parse(input.orderId)
  z.string().min(8).max(300).parse(input.providerEvent.eventId)
  return transaction(pool, async client => {
    const order = await client.query('SELECT id,status,payment_attempts FROM shared_orders WHERE id=$1 FOR UPDATE', [input.orderId])
    if (!order.rowCount) throw new Error('order_unavailable')
    const inserted = await client.query('INSERT INTO shared_payment_events(event_id,order_id,kind,payload) VALUES($1,$2,$3,$4) ON CONFLICT (event_id) DO NOTHING RETURNING event_id',
      [input.providerEvent.eventId, input.orderId, input.providerEvent.kind, { orderId: input.orderId }])
    if (!inserted.rowCount) {
      // Duplicated provider event: deduplicated, no state change, no second charge.
      return { status: order.rows[0].status as string, firstSeen: false }
    }
    const attempts = Number(order.rows[0].payment_attempts) + 1
    const nextStatus = input.providerEvent.kind === 'payment_intent.succeeded' ? 'paid' : input.providerEvent.kind === 'payment_intent.canceled' ? 'cancelled' : 'pending'
    await client.query('UPDATE shared_orders SET status=$1,payment_attempts=$2,paid_at=CASE WHEN $1=\'paid\' THEN clock_timestamp() ELSE paid_at END WHERE id=$3', [nextStatus, attempts, input.orderId])
    return { status: nextStatus, firstSeen: true }
  })
}

/** Link a paid order to provisioning: exactly one provision job enqueue per
 * paid order, idempotent on retries and race-safe without nested
 * transactions (the provision business key is a per-tenant singleton, so
 * concurrent callers converge on the same job id). */
export async function provisionPaidOrder(pool: Pool, input: { orderId: string; actor: { issuer: string; actorUid: number } }): Promise<{ jobId: string; status: string }> {
  z.uuid().parse(input.orderId)
  // Fast path: an order already linked returns its job.
  const existing = await transaction(pool, async client => {
    const order = await client.query('SELECT provision_job_id::text AS provision_job_id,status FROM shared_orders WHERE id=$1', [input.orderId])
    if (!order.rowCount) throw new Error('order_unavailable')
    return order.rows[0]
  })
  if (existing.provision_job_id) return { jobId: existing.provision_job_id, status: 'provisioned' }
  if (existing.status !== 'paid') throw new Error('order_not_paid')
  const read = await transaction(pool, async client => {
    const order = await client.query('SELECT control_tenant_id,quote FROM shared_orders WHERE id=$1 AND status=\'paid\'', [input.orderId])
    if (!order.rowCount) throw new Error('order_not_paid')
    return order.rows[0]
  })
  const quote = read.quote as Quote
  await transaction(pool, async client => {
    await client.query('UPDATE tenants SET catalog_version=$1,catalog_tier=$2 WHERE id=$3', [quote.catalogVersion, quote.catalogTier, read.control_tenant_id])
  })
  const job = await enqueueSharedJob(pool, read.control_tenant_id, input.actor, { schemaVersion: 1, operation: 'provision', requestId: randomUUID() }, `Provision paid order ${input.orderId}`)
  await transaction(pool, async client => {
    const claimed = await client.query('UPDATE shared_orders SET provision_job_id=$1 WHERE id=$2 AND status=\'paid\' AND (provision_job_id IS NULL OR provision_job_id=$1) RETURNING provision_job_id', [job.id, input.orderId])
    if (!claimed.rowCount) {
      const current = await client.query('SELECT provision_job_id::text AS provision_job_id FROM shared_orders WHERE id=$1', [input.orderId])
      if (current.rows[0]?.provision_job_id && current.rows[0].provision_job_id !== job.id) return
      throw new Error('order_not_paid')
    }
  })
  return { jobId: job.id, status: 'provisioned' }
}

/** Post-provision reconciliation: a paid order becomes 'provisioned' only when
 * its tenant is durably active; otherwise it reports 'paid_not_ready' — never
 * a silent success. */
export async function reconcilePaidOrder(pool: Pool, orderId: string): Promise<{ status: string }> {
  z.uuid().parse(orderId)
  return transaction(pool, async client => {
    const order = await client.query(`SELECT o.id,o.status,t.status AS tenant_status FROM shared_orders o JOIN tenants t ON t.id=o.control_tenant_id WHERE o.id=$1 FOR UPDATE OF o`, [orderId])
    if (!order.rowCount) throw new Error('order_unavailable')
    const row = order.rows[0]
    if (row.status !== 'paid' && row.status !== 'provisioned' && row.status !== 'paid_not_ready') return { status: row.status as string }
    const next = row.tenant_status === 'active' ? 'provisioned' : 'paid_not_ready'
    await client.query('UPDATE shared_orders SET status=$1 WHERE id=$2', [next, orderId])
    return { status: next }
  })
}
