import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { migrate, transaction } from '../db.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { PaymentError } from '../commercial/payment-adapter.js'
import { createPaymentAttempt, handleProviderEvent, reconcileUnknownAttempts } from '../commercial/payments.js'
import { url } from './commercial-helpers.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'

const suite = url ? describe : describe.skip
suite('bounded authoritative payment reconciliation on PostgreSQL', () => {
  const pool = new Pool({ connectionString: url, max: 8 })
  const now = new Date('2026-10-05T12:00:00Z')
  const options = { clock: () => now.getTime(), limit: 20 }
  beforeAll(async () => { await migrate(pool) })
  beforeEach(async () => { await pool.query('TRUNCATE customers CASCADE'); await pool.query('TRUNCATE commercial_outbox') })
  afterAll(async () => { await pool.end() })
  async function fixture(adapter = new SimulatorAdapter()) {
    const customer = randomUUID(), subscription = randomUUID(), revision = randomUUID(), order = randomUUID(), invoice = randomUUID()
    await transaction(pool, async c => {
      await c.query('INSERT INTO customers(id,name) VALUES($1,$2)', [customer, 'Reconciliation test'])
      await c.query('INSERT INTO subscriptions(id,customer_id) VALUES($1,$2)', [subscription, customer])
      await c.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)', [revision, subscription, '{}', randomUUID()])
      await c.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
        VALUES($1,$2,$3,'new',$4,$5,'awaiting_payment','not_started',$6,'fixture',11500,'SAR',2)`, [order, customer, subscription, randomUUID(), revision, randomUUID()])
      await c.query(`INSERT INTO invoices(id,customer_id,subscription_id,order_id,kind,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,due_at)
        VALUES($1,$2,$3,$4,'initial','SAR',2,10000,1500,11500,'2026-01-01','2026-02-01',now())`, [invoice, customer, subscription, order])
    })
    const attempt = await createPaymentAttempt(pool, { order_id: order, customer_id: customer, adapter, returnOrigin: fixedReturnOrigin('https://liwan.test') })
    await pool.query("UPDATE payment_attempts SET created_at=$2,updated_at=$2 WHERE id=$1", [attempt.id, new Date(now.getTime() - 600_000)])
    return { adapter, attempt, order, invoice }
  }
  async function state(order: string) { return (await pool.query('SELECT payment_state,fulfillment_state,cancelled FROM orders WHERE id=$1', [order])).rows[0] }

  // Restricting the selection to unknown loses successfully-created checkouts when webhooks disappear.
  it.each(['created', 'unknown', 'redirected', 'pending'])('settles a stale %s checkout without a webhook or another provider write', async status => {
    const f = await fixture()
    await pool.query('UPDATE payment_attempts SET status=$2,provider_ref=CASE WHEN $2 IN (\'created\',\'unknown\') THEN NULL ELSE provider_ref END WHERE id=$1', [f.attempt.id, status])
    f.adapter.settle(f.attempt.provider_ref)
    const create = vi.spyOn(f.adapter, 'createAttempt'), charge = vi.spyOn(f.adapter, 'chargeToken'), refund = vi.spyOn(f.adapter, 'refund')
    expect(await reconcileUnknownAttempts(pool, f.adapter, options)).toEqual([{ id: f.attempt.id, outcome: 'accepted' }])
    expect(await state(f.order)).toMatchObject({ payment_state: 'paid', fulfillment_state: 'queued' })
    expect((await pool.query('SELECT status FROM invoices WHERE id=$1', [f.invoice])).rows[0].status).toBe('paid')
    expect(create).not.toHaveBeenCalled(); expect(charge).not.toHaveBeenCalled(); expect(refund).not.toHaveBeenCalled()
    await handleProviderEvent(pool, { provider: 'simulator', adapter: f.adapter, rawBody: f.adapter.webhookBody(f.attempt.provider_ref), headers: {} })
    expect((await pool.query("SELECT count(*)::int AS n FROM commercial_outbox WHERE aggregate_id=$1 AND kind='fulfillment.enqueue'", [f.order])).rows[0].n).toBe(1)
  })
  it('does not reconcile a recently reserved created attempt while creation may still be running', async () => {
    const f = await fixture()
    f.adapter.settle(f.attempt.provider_ref)
    await pool.query("UPDATE payment_attempts SET status='created',created_at=$2,updated_at=$2 WHERE id=$1", [f.attempt.id, now])
    expect(await reconcileUnknownAttempts(pool, f.adapter, options)).toEqual([])
    expect(await state(f.order)).toMatchObject({ payment_state: 'awaiting_payment' })
  })
  it('bounds work and rotates unreachable oldest rows so later attempts can settle', async () => {
    const adapter = new SimulatorAdapter(), first = await fixture(adapter), second = await fixture(adapter)
    await pool.query("UPDATE payment_attempts SET status='unknown',updated_at=$2 WHERE id=$1", [first.attempt.id, new Date(now.getTime() - 700_000)])
    adapter.settle(second.attempt.provider_ref)
    const lookup = adapter.lookupAttempt.bind(adapter)
    vi.spyOn(adapter, 'lookupAttempt').mockImplementation(ref => ref === first.attempt.provider_ref ? Promise.reject(new PaymentError('provider_unreachable', 'secret diagnostic')) : lookup(ref))
    expect(await reconcileUnknownAttempts(pool, adapter, { ...options, limit: 1 })).toEqual([{ id: first.attempt.id, outcome: 'provider_unavailable' }])
    expect(await state(second.order)).toMatchObject({ payment_state: 'awaiting_payment' })
    expect(await reconcileUnknownAttempts(pool, adapter, { ...options, limit: 1 })).toEqual([{ id: second.attempt.id, outcome: 'accepted' }])
    expect(await state(second.order)).toMatchObject({ payment_state: 'paid' })
  })
  it.each(['missing', 'mismatch'] as const)('keeps %s lookup unresolved without releasing the order', async fault => {
    const f = await fixture()
    await pool.query("UPDATE payment_attempts SET status='unknown',provider_ref=NULL WHERE id=$1", [f.attempt.id])
    const event = await f.adapter.lookupAttempt(f.attempt.provider_ref)
    vi.spyOn(f.adapter, 'lookupByAttemptId').mockResolvedValue(fault === 'missing' ? null : { ...event, amount: { ...event.amount, minor: 1 } })
    expect(await reconcileUnknownAttempts(pool, f.adapter, options)).toEqual([{ id: f.attempt.id, outcome: fault === 'missing' ? 'unknown' : 'mismatch' }])
    expect(await state(f.order)).toMatchObject({ payment_state: 'awaiting_payment', cancelled: false })
    expect((await pool.query('SELECT status,provider_ref FROM payment_attempts WHERE id=$1', [f.attempt.id])).rows[0]).toEqual({ status: 'unknown', provider_ref: null })
  })
  it('keeps the order payable but unreleased after an authoritative provider cancellation', async () => {
    const f = await fixture()
    await f.adapter.cancelAttempt(f.attempt.provider_ref)
    expect(await reconcileUnknownAttempts(pool, f.adapter, options)).toEqual([{ id: f.attempt.id, outcome: 'accepted' }])
    expect(await state(f.order)).toEqual({ payment_state: 'awaiting_payment', fulfillment_state: 'not_started', cancelled: false })
    expect((await pool.query('SELECT status FROM payment_attempts WHERE id=$1', [f.attempt.id])).rows[0].status).toBe('canceled')
    expect((await pool.query("SELECT count(*)::int AS n FROM commercial_outbox WHERE aggregate_id=$1", [f.order])).rows[0].n).toBe(0)
  })
})
