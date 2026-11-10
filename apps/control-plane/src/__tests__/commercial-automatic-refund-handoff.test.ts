import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { transaction } from '../db.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { enqueueOutbox } from '../commercial/outbox.js'
import { attention } from '../commercial/attention.js'
import { processRefundOutbox, recordFulfillmentFailure, refundCreditNote } from '../commercial/settlements.js'
import { setup, url } from './commercial-helpers.js'

const suite = url ? describe : describe.skip
suite('automatic refund that cannot finish is handed to the operator on PostgreSQL', () => {
  const pool = new Pool({ connectionString: url, max: 6 })
  beforeAll(async () => { await setup(pool) })
  beforeEach(async () => { await pool.query('TRUNCATE customers CASCADE'); await pool.query('TRUNCATE commercial_outbox') })
  afterAll(async () => { await pool.end() })

  /** An order cancelled by trial expiry whose payment arrived late: refund_pending, an automatic refund row, and the invoice state the case needs. */
  async function lateOrder(options: { provider?: string; undelivered?: boolean; vendorNote?: boolean } = {}) {
    const customer = randomUUID(), sub = randomUUID(), revision = randomUUID(), order = randomUUID(), invoice = randomUUID(), attempt = randomUUID()
    return transaction(pool, async c => {
      await c.query('INSERT INTO customers(id,name) VALUES($1,$2)', [customer, 'Handoff test'])
      await c.query('INSERT INTO subscriptions(id,customer_id) VALUES($1,$2)', [sub, customer])
      await c.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)', [revision, sub, '{}', randomUUID()])
      await c.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,cancelled,automatic_refund,
        idempotency_key,request_digest,due_now_minor,currency,exponent) VALUES($1,$2,$3,'change',$4,$5,'refund_pending','not_started',true,true,$6,'fixture',11500,'SAR',2)`,
      [order, customer, sub, randomUUID(), revision, randomUUID()])
      await c.query(`INSERT INTO invoices(id,customer_id,subscription_id,order_id,kind,status,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,due_at)
        VALUES($1,$2,$3,$4,'change',$5,'SAR',2,10000,1500,11500,'2026-01-01','2026-02-01',now())`, [invoice, customer, sub, order, options.undelivered || options.vendorNote ? 'paid' : 'void'])
      await c.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status,succeeded_at)
        VALUES($1,$2,$3,$4,$5,$6,11500,'SAR',2,'succeeded',now())`, [attempt, order, invoice, options.provider ?? 'moyasar', options.provider === 'simulator' ? 'simulator' : 'live', `ref-${attempt}`])
      await c.query('UPDATE orders SET paid_attempt_id=$2 WHERE id=$1', [order, attempt])
      let note = ''
      if (options.undelivered) note = (await recordFulfillmentFailure(c, { order_id: order, reason: 'Fulfillment failed permanently', actor: 'commercial-fulfillment' }))[0]!
      if (options.vendorNote) {
        note = randomUUID()
        await c.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin)
          VALUES($1,$2,$3,'credit_note','Customer asked for the money back',11500,'SAR',2,'pending','vendor:1','vendor')`, [note, invoice, customer])
      }
      await enqueueOutbox(c, { kind: 'reconcile.refund', aggregate_id: order, dedupe_key: options.undelivered ? 'fulfillment-undelivered' : randomUUID(),
        payload: { attempt_id: attempt, automatic: true } })
      return { customer, order, invoice, attempt, note }
    })
  }
  const outbox = async (order: string) => (await pool.query('SELECT status,attempts,payload FROM commercial_outbox WHERE aggregate_id=$1', [order])).rows[0]
  const notes = async (invoice: string) => (await pool.query('SELECT id,status,reason,origin,amount_minor::int AS minor FROM invoice_adjustments WHERE invoice_id=$1 ORDER BY created_at', [invoice])).rows
  const orderState = async (order: string) => (await pool.query('SELECT payment_state FROM orders WHERE id=$1', [order])).rows[0].payment_state
  const operatorRefund = (adjustment_id: string) => refundCreditNote(pool, { adjustment_id, actor: { issuer: 'vendor-test', actorUid: 7 },
    request: { external_reference: `BANK-${adjustment_id}`, reason: 'Refunded by bank transfer' } })

  it('F1 hands a late-payment refund to one manual credit note when no payment adapter is configured', async () => {
    const f = await lateOrder()
    expect(await processRefundOutbox(pool)).toBe(1)
    expect(await outbox(f.order)).toMatchObject({ status: 'failed', payload: { automatic: true, error: 'provider_refund_unavailable' } })
    expect(await notes(f.invoice)).toEqual([expect.objectContaining({ status: 'pending', reason: 'payment after cancellation — manual review', origin: 'system', minor: 11500 })])
    expect(await orderState(f.order)).toBe('refund_pending')
    expect((await pool.query("SELECT 1 FROM audit_events WHERE action='payment.refund_rejected' AND subject=$1", [f.order])).rowCount).toBe(1)
    // The worker makes no second note, and the operator's refund finishes the order.
    await processRefundOutbox(pool)
    const [note] = await notes(f.invoice)
    expect(await notes(f.invoice)).toHaveLength(1)
    await operatorRefund(note.id)
    expect(await orderState(f.order)).toBe('refunded')
  })

  it('F1 hands a payment the provider cannot refund to the operator on the first try', async () => {
    const f = await lateOrder()
    expect(await processRefundOutbox(pool, new SimulatorAdapter())).toBe(1)
    expect(await outbox(f.order)).toMatchObject({ status: 'failed', payload: { error: 'provider_refund_unavailable' } })
    expect(await notes(f.invoice)).toHaveLength(1)
  })

  it('F1 retries a transient refund failure with backoff, then closes it for operator verification once the attempts are used', async () => {
    const f = await lateOrder({ provider: 'simulator' }) // the simulator does not know this ref: the lookup fails
    const adapter = new SimulatorAdapter()
    await processRefundOutbox(pool, adapter)
    expect(await outbox(f.order)).toMatchObject({ status: 'pending', attempts: 1 })
    expect(await notes(f.invoice)).toHaveLength(0)
    await pool.query('UPDATE commercial_outbox SET attempts=5,next_attempt_at=now() WHERE aggregate_id=$1', [f.order])
    await processRefundOutbox(pool, adapter)
    expect(await outbox(f.order)).toMatchObject({ status: 'failed' })
    // A transient error may follow a refund the provider made: no note, the operator verifies the provider first.
    expect(await notes(f.invoice)).toHaveLength(0)
    expect((await attention(pool, true)).items.filter(i => i.kind === 'refund_rejected' && i.customer_id === f.customer)).toHaveLength(1)
  })

  it('F1 keeps the single fulfilment note of an undelivered order when its refund is handed over', async () => {
    const f = await lateOrder({ undelivered: true })
    await processRefundOutbox(pool)
    expect(await outbox(f.order)).toMatchObject({ status: 'failed', payload: { automatic: true, attempt_id: f.attempt } })
    expect(await notes(f.invoice)).toEqual([expect.objectContaining({ id: f.note, status: 'pending', minor: 11500 })])
    // The pending note already covers the invoice: the operator works that note, no rejection is left unseen.
    expect((await attention(pool, true)).items.filter(i => i.kind === 'refund_rejected' && i.customer_id === f.customer)).toHaveLength(0)
    await operatorRefund(f.note)
    expect(await orderState(f.order)).toBe('refunded')
  })

  it('F4 a provider refund closes the customer pending refund request for the same invoice', async () => {
    const f = await lateOrder({ vendorNote: true })
    const adapter = new SimulatorAdapter()
    const created = await adapter.createAttempt({ attempt_id: f.attempt, order_id: f.order, amount: { minor: 11500, currency: 'SAR', exponent: 2 },
      description: 'x', success_url: '', back_url: '', callback_url: '' })
    adapter.settle(created.provider_ref)
    await pool.query("UPDATE payment_attempts SET provider='simulator',mode='simulator',provider_ref=$2 WHERE id=$1", [f.attempt, created.provider_ref])
    expect(await processRefundOutbox(pool, adapter)).toBe(1)
    expect(await outbox(f.order)).toMatchObject({ status: 'done' })
    expect(await notes(f.invoice)).toEqual([expect.objectContaining({ id: f.note, status: 'refunded', origin: 'vendor' })])
    expect(await orderState(f.order)).toBe('refunded')
  })
})
