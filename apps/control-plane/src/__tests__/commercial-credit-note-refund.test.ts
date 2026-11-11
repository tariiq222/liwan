import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { transaction } from '../db.js'
import { routesB } from '../commercial/routes-b.js'
import { processRefundOutbox, recordFulfillmentFailure, refundCreditNote, requestInvoiceRefund } from '../commercial/settlements.js'
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
      await c.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status,succeeded_at)
        VALUES($1,$2,$3,'moyasar','live',$4,11500,'SAR',2,'succeeded',now())`, [attempt, order, invoice, `moy-${attempt}`])
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
  const refundedPayload = (f: { order: string; attempt: string }, minor: number, extra: Record<string, unknown> = {}) =>
    ({ order_id: f.order, attempt_id: f.attempt, reason: 'Payment refunded after fulfillment — manual review', refunded: { currency: 'SAR', exponent: 2, minor }, ...extra })
  const enqueueRefund = (f: { order: string; attempt: string }, payload: unknown, key = randomUUID()) =>
    enqueueOutbox(pool as never, { kind: 'payment.intervention', aggregate_id: f.order, dedupe_key: key, payload })
  const notesOf = async (invoice: string) => (await pool.query('SELECT * FROM invoice_adjustments WHERE invoice_id=$1 ORDER BY amount_minor', [invoice])).rows
  const outboxOf = async (order: string) => (await pool.query("SELECT status,payload FROM commercial_outbox WHERE kind='payment.intervention' AND aggregate_id=$1 ORDER BY created_at", [order])).rows

  it('turns a full refund after fulfillment into a pending credit note the operator can close', async () => {
    const f = await failedOrder('applied')
    await enqueueRefund(f, refundedPayload(f, 11500))
    expect(await processRefundOutbox(pool)).toBe(1)
    const notes = await notesOf(f.invoice)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ kind: 'credit_note', status: 'pending', origin: 'system', amount_minor: '11500', currency: 'SAR' })
    expect((await pool.query('SELECT status FROM invoices WHERE id=$1', [f.invoice])).rows[0].status).toBe('credit_pending')
    expect((await outboxOf(f.order))[0].status).toBe('done')
    await expect(call(notes[0].id, ok)).resolves.toMatchObject({ status: 200, data: { status: 'refunded' } })
  })
  it('credits only the refunded part of a partial refund and lets the operator record it', async () => {
    const f = await failedOrder('applied')
    await enqueueRefund(f, refundedPayload(f, 4000))
    await processRefundOutbox(pool)
    const notes = await notesOf(f.invoice)
    expect(notes.map(n => n.amount_minor)).toEqual(['4000'])
    await expect(call(notes[0].id, ok)).resolves.toMatchObject({ status: 200, data: { status: 'refunded', amount: { minor: 4000 } } })
  })
  it('credits each further partial refund by its own part and never more than was paid', async () => {
    const f = await failedOrder('applied')
    await enqueueRefund(f, refundedPayload(f, 4000))
    await processRefundOutbox(pool)
    await enqueueRefund(f, refundedPayload(f, 11500))
    await processRefundOutbox(pool)
    expect((await notesOf(f.invoice)).map(n => n.amount_minor)).toEqual(['4000', '7500'])
    // A replay of an earlier state, and the final state again, add nothing.
    await enqueueRefund(f, refundedPayload(f, 4000)); await enqueueRefund(f, refundedPayload(f, 11500))
    await processRefundOutbox(pool)
    expect((await notesOf(f.invoice)).map(n => n.amount_minor)).toEqual(['4000', '7500'])
    expect((await notesOf(f.invoice)).reduce((sum, n) => sum + Number(n.amount_minor), 0)).toBe(11500)
  })
  it('rejects a refund above what was paid, or in another currency, with a visible reason and no note', async () => {
    const f = await failedOrder('applied')
    await enqueueRefund(f, refundedPayload(f, 12000))
    await enqueueRefund(f, { ...refundedPayload(f, 5000), refunded: { currency: 'USD', exponent: 2, minor: 5000 } })
    await enqueueRefund(f, { order_id: f.order, attempt_id: f.attempt, reason: 'No figure' })
    await processRefundOutbox(pool)
    expect(await notesOf(f.invoice)).toHaveLength(0)
    const rows = await outboxOf(f.order)
    expect(rows.map(r => r.status)).toEqual(['failed', 'failed', 'failed'])
    expect(rows.map(r => r.payload.error).sort()).toEqual(['refund_amount_missing', 'refund_currency_mismatch', 'refund_exceeds_payment'])
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='payment.refund_rejected' AND subject=$1", [f.order])).rows[0].n).toBe(3)
  })
  it('rejects a malformed row and still processes every other row of the batch', async () => {
    const good = await failedOrder('applied')
    const orphan = { order: randomUUID(), attempt: randomUUID() }
    await enqueueRefund(orphan, refundedPayload(orphan, 5000))
    await enqueueRefund(orphan, { order_id: orphan.order, refunded: { currency: 'SAR', exponent: 2, minor: 5000 } })
    await enqueueRefund(good, refundedPayload(good, 11500))
    await pool.query("UPDATE commercial_outbox SET created_at=now() + interval '1 second' WHERE aggregate_id=$1", [good.order])
    expect(await processRefundOutbox(pool)).toBe(3)
    expect((await outboxOf(orphan.order)).map(r => [r.status, r.payload.error]).sort()).toEqual([['failed', 'attempt_id_missing'], ['failed', 'payment_attempt_missing']])
    expect((await notesOf(good.invoice)).map(n => n.amount_minor)).toEqual(['11500'])
    expect((await outboxOf(good.order))[0].status).toBe('done')
    // Nothing is left pending, so the next pass has nothing to stall on.
    expect(await processRefundOutbox(pool)).toBe(0)
  })

  const operator = { issuer: 'vendor-test', actorUid: 7 }
  const askRefund = (invoice: string) => requestInvoiceRefund(pool, { invoice_id: invoice, actor: operator, reason: 'Customer asked for the money back' })
  const recordRef = (note: string, reference: string) => refundCreditNote(pool, { adjustment_id: note, actor: operator, request: { external_reference: reference, reason: 'Refunded in the provider dashboard' } })
  const totalCredited = async (invoice: string) => (await notesOf(invoice)).filter(n => n.status !== 'void').reduce((sum, n) => sum + Number(n.amount_minor), 0)

  it('adds no second note when the operator refunded through the vendor flow before the provider event arrives', async () => {
    const f = await failedOrder('applied')
    const vendorNote = await askRefund(f.invoice)
    expect(vendorNote).toMatchObject({ origin: 'vendor', status: 'pending', amount: { minor: 11500 } })
    await recordRef(vendorNote.id, 'MOY-OPERATOR-1')
    // The provider's refund event for that same money, whole and then repeated as a larger-or-equal state.
    await enqueueRefund(f, refundedPayload(f, 11500))
    await processRefundOutbox(pool)
    expect((await notesOf(f.invoice)).map(n => [n.origin, n.status, n.amount_minor])).toEqual([['vendor', 'refunded', '11500']])
    expect((await outboxOf(f.order))[0].status).toBe('done')
    // A partial event never credits more either; the total stays at what was paid.
    await enqueueRefund(f, refundedPayload(f, 4000))
    await processRefundOutbox(pool)
    expect(await totalCredited(f.invoice)).toBe(11500)
  })
  it('lets the operator settle the existing system note when the provider event arrived first', async () => {
    const f = await failedOrder('applied')
    await enqueueRefund(f, refundedPayload(f, 11500))
    await processRefundOutbox(pool)
    const [system] = await notesOf(f.invoice)
    expect(system).toMatchObject({ origin: 'system', status: 'pending', amount_minor: '11500' })
    // Asking for the refund attaches to that note: no second obligation, and the reference closes it.
    expect(await askRefund(f.invoice)).toMatchObject({ id: system.id, origin: 'system', status: 'pending' })
    expect(await notesOf(f.invoice)).toHaveLength(1)
    await expect(recordRef(system.id, 'MOY-OPERATOR-2')).resolves.toMatchObject({ id: system.id, status: 'refunded' })
    await expect(askRefund(f.invoice)).rejects.toMatchObject({ status: 409, code: 'refund_already_requested' })
    expect(await totalCredited(f.invoice)).toBe(11500)
  })
  it('credits only what the vendor notes leave uncovered when a larger cumulative provider event follows', async () => {
    const f = await failedOrder('applied')
    // A vendor-origin note for part of the payment (the vendor flow itself only writes whole-invoice notes).
    await pool.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin)
      SELECT $1,$2,customer_id,'credit_note','Customer asked for part of it back',4000,'SAR',2,'pending','vendor-test','vendor' FROM invoices WHERE id=$2`, [randomUUID(), f.invoice])
    await enqueueRefund(f, refundedPayload(f, 9000))
    await processRefundOutbox(pool)
    expect((await notesOf(f.invoice)).map(n => [n.origin, n.amount_minor])).toEqual([['vendor', '4000'], ['system', '5000']])
    await enqueueRefund(f, refundedPayload(f, 11500))
    await processRefundOutbox(pool)
    expect(await totalCredited(f.invoice)).toBe(11500)
    // Neither the provider's figure nor the payment is exceeded, and a replay changes nothing.
    await enqueueRefund(f, refundedPayload(f, 11500))
    await processRefundOutbox(pool)
    expect(await totalCredited(f.invoice)).toBe(11500)
  })
})
