import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { transaction } from '../db.js'
import { routesB } from '../commercial/routes-b.js'
import { processRefundOutbox, recordFulfillmentFailure } from '../commercial/settlements.js'
import { enqueueOutbox } from '../commercial/outbox.js'
import { setup, url } from './commercial-helpers.js'

const suite = url ? describe : describe.skip
suite('operator refund of a pending credit note on PostgreSQL', () => {
  const pool = new Pool({ connectionString: url, max: 6 })
  beforeAll(async () => { await setup(pool) })
  beforeEach(async () => { await pool.query('TRUNCATE customers CASCADE'); await pool.query('TRUNCATE commercial_outbox') })
  afterAll(async () => { await pool.end() })

  /** A paid order whose fulfillment failed: the invoice is credit_pending with one pending credit note. */
  async function failedOrder(fulfillment: 'failed' | 'applied' = 'failed') {
    const customer = randomUUID(), sub = randomUUID(), revision = randomUUID(), order = randomUUID(), invoice = randomUUID()
    return transaction(pool, async c => {
      await c.query('INSERT INTO customers(id,name) VALUES($1,$2)', [customer, 'Refund test'])
      await c.query('INSERT INTO subscriptions(id,customer_id) VALUES($1,$2)', [sub, customer])
      await c.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)', [revision, sub, '{}', randomUUID()])
      await c.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
        VALUES($1,$2,$3,'new',$4,$5,'paid',$7,$6,'fixture',11500,'SAR',2)`, [order, customer, sub, randomUUID(), revision, randomUUID(), fulfillment])
      await c.query(`INSERT INTO invoices(id,customer_id,subscription_id,order_id,kind,status,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,due_at)
        VALUES($1,$2,$3,$4,'initial','paid','SAR',2,10000,1500,11500,'2026-01-01','2026-02-01',now())`, [invoice, customer, sub, order])
      // A paid order was paid: its successful attempt is what makes the payment refundable (W7).
      const attempt = randomUUID()
      await c.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status)
        VALUES($1,$2,$3,'moyasar','live',$4,11500,'SAR',2,'succeeded')`, [attempt, order, invoice, `moy-${attempt}`])
      await c.query('UPDATE orders SET paid_attempt_id=$2 WHERE id=$1', [order, attempt])
      if (fulfillment === 'applied') return { invoice, order, attempt, note: '' }
      const [note] = await recordFulfillmentFailure(c, { order_id: order, reason: 'Fulfillment failed permanently', actor: 'system' })
      return { invoice, order, attempt, note: note! }
    })
  }
  const call = (note: string, body: unknown, options: { caps?: string[]; stepUp?: boolean; method?: string } = {}) => {
    const pathname = `/v1/commercial/invoice-adjustments/${note}/refund`
    return routesB(pool, { method: options.method ?? 'POST', pathname, raw: JSON.stringify(body), issuer: 'vendor-test', actor: 7,
      capabilities: (options.caps ?? ['vendor.read', 'vendor.billing.manage']) as any, stepUpFresh: options.stepUp ?? true }, new URL(pathname, 'https://liwan.test'))
  }
  const ok = { external_reference: 'MOY-REFUND-77', reason: 'Refunded in the provider dashboard' }
  const row = async (id: string) => (await pool.query('SELECT * FROM invoice_adjustments WHERE id=$1', [id])).rows[0]
  const audits = async (id: string) => (await pool.query("SELECT * FROM audit_events WHERE subject=$1 AND action='invoice.credit_refunded'", [id])).rows

  it('closes a pending credit note with the reference, the actor and an audit row', async () => {
    const f = await failedOrder()
    const result = await call(f.note, ok)
    expect(result).toMatchObject({ status: 200, data: { id: f.note, status: 'refunded', refund_reference: 'MOY-REFUND-77', amount: { minor: 11500, currency: 'SAR', exponent: 2 } } })
    const stored = await row(f.note)
    expect(stored).toMatchObject({ status: 'refunded', refund_reference: 'MOY-REFUND-77', refunded_by: (result!.data as any).refunded_by })
    expect(stored.refunded_by).toMatch(/:7$/); expect(stored.refunded_at).toBeInstanceOf(Date)
    const [audit] = await audits(f.note)
    expect(audit).toMatchObject({ actor: stored.refunded_by, reason: ok.reason })
    expect(audit.metadata).toMatchObject({ invoice_id: f.invoice, external_reference: 'MOY-REFUND-77', amount_minor: 11500, currency: 'SAR' })
    // The invoice itself is immutable: only the credit note moves.
    expect((await pool.query('SELECT status FROM invoices WHERE id=$1', [f.invoice])).rows[0].status).toBe('credit_pending')
  })
  it('is idempotent for the same reference and refuses a different one on a closed note', async () => {
    const f = await failedOrder()
    const first = await call(f.note, ok), again = await call(f.note, { ...ok, reason: 'A retry after a lost response' })
    expect(again).toEqual(first)
    expect(await audits(f.note)).toHaveLength(1)
    await expect(call(f.note, { ...ok, external_reference: 'MOY-OTHER-1' })).rejects.toMatchObject({ status: 409, code: 'credit_note_not_pending' })
    expect((await row(f.note)).refund_reference).toBe('MOY-REFUND-77')
    expect(await audits(f.note)).toHaveLength(1)
  })
  it('refuses a refund reference that already closed another credit note', async () => {
    const one = await failedOrder(), two = await failedOrder()
    await call(one.note, ok)
    await expect(call(two.note, ok)).rejects.toMatchObject({ status: 409, code: 'refund_reference_in_use' })
    expect((await row(two.note)).status).toBe('pending'); expect(await audits(two.note)).toHaveLength(0)
    await expect(call(two.note, { ...ok, external_reference: 'MOY-REFUND-78' })).resolves.toMatchObject({ status: 200 })
  })
  it('lets exactly one of two concurrent different references win', async () => {
    const f = await failedOrder()
    const results = await Promise.allSettled([call(f.note, { ...ok, external_reference: 'MOY-A-111' }), call(f.note, { ...ok, external_reference: 'MOY-B-222' })])
    expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ status: 409, code: 'credit_note_not_pending' })
    expect(await audits(f.note)).toHaveLength(1)
  })
  it.each([['a debit note', "kind='debit_note'"], ['a voided note', "status='void'"], ['an applied note', "status='applied'"]])('refuses %s', async (_label, set) => {
    const f = await failedOrder()
    await pool.query(`UPDATE invoice_adjustments SET ${set} WHERE id=$1`, [f.note])
    await expect(call(f.note, ok)).rejects.toMatchObject({ status: 409, code: 'credit_note_not_pending' })
    expect((await row(f.note)).refund_reference).toBeNull(); expect(await audits(f.note)).toHaveLength(0)
  })
  it('needs the billing capability and a fresh step-up, and answers 404 for an unknown or malformed id', async () => {
    const f = await failedOrder()
    for (const caps of [['vendor.read'], ['vendor.read', 'vendor.subscriptions.manage', 'vendor.pricing.manage']])
      await expect(call(f.note, ok, { caps })).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    await expect(call(f.note, ok, { stepUp: false })).rejects.toMatchObject({ status: 403, code: 'step_up_required' })
    await expect(call(randomUUID(), ok)).rejects.toMatchObject({ status: 404 })
    await expect(call('not-a-uuid', ok)).rejects.toMatchObject({ status: 404 })
    expect((await row(f.note)).status).toBe('pending'); expect(await audits(f.note)).toHaveLength(0)
  })
  it('validates the body and only accepts POST', async () => {
    const f = await failedOrder()
    for (const body of [{ ...ok, external_reference: 'ab' }, { ...ok, reason: 'no' }, { reason: ok.reason }, { ...ok, amount: 1 }, {}])
      await expect(call(f.note, body)).rejects.toMatchObject({ status: 422 })
    expect(await call(f.note, ok, { method: 'GET' })).toBeNull()
    expect((await row(f.note)).status).toBe('pending')
  })
  it('keeps refund details and status consistent in the database', async () => {
    const f = await failedOrder()
    await expect(pool.query("UPDATE invoice_adjustments SET status='refunded' WHERE id=$1", [f.note])).rejects.toThrow(/invoice_adjustments_refund_recorded/)
    await expect(pool.query("UPDATE invoice_adjustments SET refund_reference='MOY-1' WHERE id=$1", [f.note])).rejects.toThrow(/invoice_adjustments_refund_recorded/)
  })
  it('shows the notes, with the refund, on the vendor invoice', async () => {
    const f = await failedOrder()
    const read = async () => {
      const pathname = `/v1/commercial/invoices/${f.invoice}`
      return (await routesB(pool, { method: 'GET', pathname, raw: '', issuer: 'vendor-test', actor: 7, capabilities: ['vendor.billing.manage'] }, new URL(pathname, 'https://liwan.test')))!.data as any
    }
    expect((await read()).adjustments).toMatchObject([{ id: f.note, kind: 'credit_note', origin: 'system', status: 'pending', refund_reference: null }])
    await call(f.note, ok)
    expect((await read()).adjustments).toMatchObject([{ id: f.note, status: 'refunded', refund_reference: 'MOY-REFUND-77' }])
  })
  it('does not show adjustments to the customer-facing invoice view', async () => {
    const f = await failedOrder()
    const { getInvoice } = await import('../commercial/invoices.js')
    expect(Object.keys((await getInvoice(pool, f.invoice))!)).not.toContain('adjustments')
  })
  it('turns a refund after fulfillment into a pending credit note the operator can close', async () => {
    const f = await failedOrder('applied')
    await pool.query('INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key,payload) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), 'payment.intervention', f.order, f.attempt, JSON.stringify({ order_id: f.order, attempt_id: f.attempt, reason: 'Payment refunded after fulfillment — manual review' })])
    expect(await processRefundOutbox(pool)).toBe(1)
    const notes = (await pool.query('SELECT * FROM invoice_adjustments WHERE invoice_id=$1', [f.invoice])).rows
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ kind: 'credit_note', status: 'pending', origin: 'system', amount_minor: '11500', currency: 'SAR' })
    expect((await pool.query('SELECT status FROM invoices WHERE id=$1', [f.invoice])).rows[0].status).toBe('credit_pending')
    expect((await pool.query("SELECT status FROM commercial_outbox WHERE kind='payment.intervention' AND aggregate_id=$1", [f.order])).rows[0].status).toBe('done')
    // The same event delivered again changes nothing, and the note closes with the provider's reference like any other.
    expect(await processRefundOutbox(pool)).toBe(0)
    await enqueueOutbox(pool as never, { kind: 'payment.intervention', aggregate_id: f.order, dedupe_key: `${f.attempt}-again`, payload: { order_id: f.order, attempt_id: f.attempt } })
    expect(await processRefundOutbox(pool)).toBe(1)
    expect((await pool.query('SELECT count(*)::int AS n FROM invoice_adjustments WHERE invoice_id=$1', [f.invoice])).rows[0].n).toBe(1)
    await expect(call(notes[0].id, ok)).resolves.toMatchObject({ status: 200, data: { status: 'refunded' } })
  })
})
