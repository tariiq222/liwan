import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { transaction } from '../db.js'
import { routesB } from '../commercial/routes-b.js'
import { processRefundOutbox, recordFulfillmentFailure, refundCreditNote, requestInvoiceRefund } from '../commercial/settlements.js'
import { enqueueOutbox } from '../commercial/outbox.js'
import { getVendorInvoice } from '../commercial/invoices.js'
import { applyConfirmedEvent } from '../commercial/payments.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { PaymentError } from '../commercial/payment-adapter.js'
import { attention } from '../commercial/attention.js'
import { setup, url } from './commercial-helpers.js'

const suite = url ? describe : describe.skip
suite('operator refund of a pending credit note on PostgreSQL', () => {
  const pool = new Pool({ connectionString: url, max: 6 })
  beforeAll(async () => { await setup(pool) })
  beforeEach(async () => { await pool.query('TRUNCATE customers CASCADE'); await pool.query('TRUNCATE commercial_outbox') })
  afterAll(async () => { await pool.end() })

  /** A paid order whose fulfillment failed: the invoice is credit_pending with one pending credit note. */
  async function failedOrder(fulfillment: 'failed' | 'applied' = 'failed', provider: 'moyasar' | 'bank_transfer' = 'moyasar') {
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
        VALUES($1,$2,$3,$5,'live',$4,11500,'SAR',2,'succeeded',now())`, [attempt, order, invoice, `moy-${attempt}`, provider])
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
    const f = await failedOrder('applied', 'bank_transfer')
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
    await pool.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin,cause)
      SELECT $1,$2,customer_id,'credit_note','Customer asked for part of it back',4000,'SAR',2,'pending','vendor-test','vendor','vendor_refund' FROM invoices WHERE id=$2`, [randomUUID(), f.invoice])
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

  /**
   * A delivered first payment of a subscription past its trial: the refund the vendor records drops it to the free base.
   * `lines` are the invoice's (kind, amount) lines; `state` is the subscription state.
   */
  /** A delivered first payment; `provider` is how it was paid: a bank transfer has no provider payment to refund, so its refund is recorded by hand. */
  async function deliveredFirstPayment(options: { lines?: [string, number][]; state?: string; provider?: 'moyasar' | 'bank_transfer' | 'simulator'; mode?: string; providerRef?: string } = {}) {
    const lines = options.lines ?? [['bundle', 10000], ['tax', 1500]]
    const total = lines.reduce((sum, [, amount]) => sum + amount, 0)
    const customer = randomUUID(), sub = randomUUID(), revision = randomUUID(), order = randomUUID(), invoice = randomUUID(), attempt = randomUUID()
    await transaction(pool, async c => {
      await c.query('INSERT INTO customers(id,name) VALUES($1,$2)', [customer, 'Refund lock test'])
      await c.query('INSERT INTO subscriptions(id,customer_id) VALUES($1,$2)', [sub, customer])
      await c.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)',
        [revision, sub, JSON.stringify({ period_start: '2026-01-01', period_end: '2026-02-01' }), randomUUID()])
      await c.query('UPDATE subscriptions SET applied_revision_id=$2,state=$3,renewal_at=$4,revision=revision+1 WHERE id=$1', [sub, revision, options.state ?? 'active', '2026-02-01'])
      await c.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
        VALUES($1,$2,$3,'new',$4,$5,'paid','applied',$6,'fixture',$7,'SAR',2)`, [order, customer, sub, randomUUID(), revision, randomUUID(), total])
      await c.query(`INSERT INTO invoices(id,customer_id,subscription_id,order_id,kind,status,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,due_at,paid_at)
        VALUES($1,$2,$3,$4,'initial','paid','SAR',2,$5,$6,$7,'2026-01-01','2026-02-01',now(),now())`,
      [invoice, customer, sub, order, total - (lines.find(([kind]) => kind === 'tax')?.[1] ?? 0), lines.find(([kind]) => kind === 'tax')?.[1] ?? 0, total])
      for (const [position, [kind, amount]] of lines.entries())
        await c.query(`INSERT INTO invoice_lines(id,invoice_id,position,key,kind,timing,description,quantity,unit_minor,amount_minor,currency,exponent,period_start,period_end,source_revision_id)
          VALUES($1,$2,$3,$4,$5,'now','Fixture line',1,$6,$6,'SAR',2,'2026-01-01','2026-02-01',$7)`, [randomUUID(), invoice, position, `${kind}:${position}`, kind, amount, revision])
      await c.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status,succeeded_at)
        VALUES($1,$2,$3,$6,$7,$4,$5,'SAR',2,'succeeded',now())`, [attempt, order, invoice, options.providerRef ?? `moy-${attempt}`, total, options.provider ?? 'moyasar', options.mode ?? 'live'])
      await c.query('UPDATE orders SET paid_attempt_id=$2 WHERE id=$1', [order, attempt])
    })
    return { customer, sub, revision, order, invoice, attempt, total }
  }
  const lockOf = async (sub: string) => (await pool.query('SELECT *,period_start::text AS start FROM free_base_locks WHERE subscription_id=$1', [sub])).rows[0]
  const lockAudits = async (sub: string) => (await pool.query("SELECT * FROM audit_events WHERE subject=$1 AND action='subscription.refund_lock_armed'", [sub])).rows
  const pendingNote = async (invoice: string, cause = 'vendor_refund', minor?: number) => {
    const id = randomUUID()
    await pool.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin,cause)
      SELECT $1,id,customer_id,'credit_note','Fixture note',COALESCE($3,total_minor),currency,exponent,'pending','vendor-test',$4,$2 FROM invoices WHERE id=$5`,
    [id, cause, minor ?? null, cause === 'vendor_refund' ? 'vendor' : 'system', invoice])
    return id
  }

  it('drops the subscription to the free base when the vendor records the refund of the first payment, once per reference', async () => {
    const f = await deliveredFirstPayment({ provider: 'bank_transfer' })
    const note = await askRefund(f.invoice)
    expect((await getVendorInvoice(pool, f.invoice))!.refund.locks_subscription).toBe(true)
    await recordRef(note.id, 'MOY-LOCK-1')
    expect(await lockOf(f.sub)).toMatchObject({ cause: 'refund', state: 'pending', pre_lock_revision_id: f.revision, start: '2026-01-01', trial_ended_at: null })
    const [armed] = await lockAudits(f.sub)
    expect(armed.metadata).toEqual({ invoice_id: f.invoice, adjustment_id: note.id })
    // A retry after a lost response returns the recorded note and arms nothing more.
    await recordRef(note.id, 'MOY-LOCK-1')
    expect(await lockAudits(f.sub)).toHaveLength(1)
  })
  it('drops on a provider refund only once the provider notes cover the whole invoice', async () => {
    const f = await deliveredFirstPayment()
    await enqueueRefund(f, refundedPayload(f, 4000))
    await processRefundOutbox(pool)
    const [part] = await notesOf(f.invoice)
    await recordRef(part.id, 'MOY-PART-1')
    expect(await lockOf(f.sub)).toBeUndefined()
    await enqueueRefund(f, refundedPayload(f, f.total))
    await processRefundOutbox(pool)
    const rest = (await notesOf(f.invoice)).find(n => n.status === 'pending')
    expect((await getVendorInvoice(pool, f.invoice))!.refund.locks_subscription).toBe(true)
    await recordRef(rest.id, 'MOY-REST-1')
    expect(await lockOf(f.sub)).toMatchObject({ cause: 'refund', state: 'pending' })
  })
  it('never drops for a top-up-only invoice, a system note, a trialing subscription or a later payment', async () => {
    const topup = await deliveredFirstPayment({ lines: [['ai_topup', 5000]] })
    await recordRef(await pendingNote(topup.invoice), 'MOY-TOPUP-1')
    expect(await lockOf(topup.sub)).toBeUndefined()
    for (const cause of ['fulfillment_failure', 'payment_after_cancellation', 'duplicate_payment', 'automatic_refund']) {
      const f = await deliveredFirstPayment()
      expect((await getVendorInvoice(pool, f.invoice))!.refund.locks_subscription).toBe(false)
      await pool.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin,cause)
        SELECT $1,id,customer_id,'credit_note','System note',total_minor,currency,exponent,'pending','system','system',$2 FROM invoices WHERE id=$3`, [randomUUID(), cause, f.invoice])
      const [note] = await notesOf(f.invoice)
      await recordRef(note.id, `MOY-${cause}`)
      expect(await lockOf(f.sub), cause).toBeUndefined()
    }
    const trialing = await deliveredFirstPayment({ state: 'trialing' })
    await recordRef(await pendingNote(trialing.invoice), 'MOY-TRIAL-1')
    expect(await lockOf(trialing.sub)).toBeUndefined()
    // A second payment on the same subscription is not the first: its refund stays with manual review.
    const f = await deliveredFirstPayment()
    const second = randomUUID(), secondOrder = randomUUID(), secondAttempt = randomUUID()
    await pool.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
      VALUES($1,$2,$3,'change',$4,$5,'paid','applied',$6,'fixture',5000,'SAR',2)`, [secondOrder, f.customer, f.sub, randomUUID(), f.revision, randomUUID()])
    await pool.query(`INSERT INTO invoices(id,customer_id,subscription_id,order_id,kind,status,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,due_at,paid_at)
      VALUES($1,$2,$3,$4,'change','paid','SAR',2,5000,0,5000,'2026-01-10','2026-02-01',now(),now())`, [second, f.customer, f.sub, secondOrder])
    await pool.query(`INSERT INTO invoice_lines(id,invoice_id,position,key,kind,timing,description,quantity,unit_minor,amount_minor,currency,exponent,period_start,period_end,source_revision_id)
      VALUES($1,$2,0,'users:delta','users','now','Users',1,5000,5000,'SAR',2,'2026-01-10','2026-02-01',$3)`, [randomUUID(), second, f.revision])
    await pool.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status,succeeded_at)
      VALUES($1,$2,$3,'moyasar','live',$4,5000,'SAR',2,'succeeded',now() + interval '1 day')`, [secondAttempt, secondOrder, second, `moy-${secondAttempt}`])
    await pool.query('UPDATE orders SET paid_attempt_id=$2 WHERE id=$1', [secondOrder, secondAttempt])
    await recordRef(await pendingNote(second), 'MOY-SECOND-1')
    expect(await lockOf(f.sub)).toBeUndefined()
  })
  it('refuses to record while an earlier lock order is still being delivered, and records nothing', async () => {
    const f = await deliveredFirstPayment({ provider: 'bank_transfer' })
    await pool.query(`INSERT INTO free_base_locks(subscription_id,pre_lock_revision_id,period_start,trial_ended_at,cause,state,order_id)
      VALUES($1,$2,'2026-01-01',now(),'trial_end','ordered',$3)`, [f.sub, f.revision, f.order])
    const note = await askRefund(f.invoice)
    await expect(recordRef(note.id, 'MOY-ORDERED-1')).rejects.toMatchObject({ status: 409, code: 'lock_pending' })
    expect((await row(note.id)).status).toBe('pending')
    expect(await lockOf(f.sub)).toMatchObject({ cause: 'trial_end', state: 'ordered' })
    expect(await lockAudits(f.sub)).toHaveLength(0)
  })
  it('voids the unpaid renewal of the paid configuration when the refund is recorded', async () => {
    const f = await deliveredFirstPayment({ state: 'past_due', provider: 'bank_transfer' })
    const renewalOrder = randomUUID(), renewalInvoice = randomUUID()
    await pool.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
      VALUES($1,$2,$3,'renewal',$4,$5,'awaiting_payment','not_started',$6,'fixture',11500,'SAR',2)`, [renewalOrder, f.customer, f.sub, randomUUID(), f.revision, randomUUID()])
    await pool.query(`INSERT INTO invoices(id,customer_id,subscription_id,order_id,kind,status,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,due_at)
      VALUES($1,$2,$3,$4,'renewal','issued','SAR',2,10000,1500,11500,'2026-02-01','2026-03-01',now())`, [renewalInvoice, f.customer, f.sub, renewalOrder])
    await pool.query("INSERT INTO renewals(id,subscription_id,period_start,period_end,invoice_id,order_id) VALUES($1,$2,'2026-02-01','2026-03-01',$3,$4)", [randomUUID(), f.sub, renewalInvoice, renewalOrder])
    await recordRef((await askRefund(f.invoice)).id, 'MOY-RENEWAL-1')
    expect((await pool.query('SELECT status FROM invoices WHERE id=$1', [renewalInvoice])).rows[0].status).toBe('void')
    expect((await pool.query('SELECT cancelled,automatic_refund FROM orders WHERE id=$1', [renewalOrder])).rows[0]).toEqual({ cancelled: true, automatic_refund: true })
    expect((await pool.query('SELECT status FROM renewals WHERE order_id=$1', [renewalOrder])).rows[0].status).toBe('superseded')
    expect(await lockOf(f.sub)).toMatchObject({ cause: 'refund', state: 'pending' })
  })
  it('turns no provider refund of an order still being delivered into a credit note', async () => {
    // A provider refund becomes a note only after delivery (`flagRefundAfterFulfillment` returns for any other state);
    // the vendor's own request waits for delivery too (the next test), so no refund note is recorded while the order is in flight.
    const f = await deliveredFirstPayment()
    await pool.query("UPDATE orders SET fulfillment_state='queued' WHERE id=$1", [f.order])
    const amount = { currency: 'SAR', exponent: 2, minor: f.total }
    await applyConfirmedEvent(pool, { provider: 'moyasar', event_id: randomUUID(), provider_ref: `moy-${f.attempt}`, payment_id: 'pay-in-flight', attempt_id: f.attempt,
      merchant_account: 'fixture', live: true, status: 'refunded', amount, refunded: amount, occurred_at: new Date().toISOString() } as never)
    expect((await pool.query("SELECT 1 FROM commercial_outbox WHERE kind='payment.intervention' AND aggregate_id=$1", [f.order])).rowCount).toBe(0)
    await processRefundOutbox(pool)
    expect(await notesOf(f.invoice)).toHaveLength(0)
    // The provider's money is already back and the order no longer counts as paid, so it is never delivered: nothing paid stays.
    expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1', [f.order])).rows[0].payment_state).not.toBe('paid')
    expect(await lockOf(f.sub)).toBeUndefined()
  })
  it('refuses to open the refund of a paid order that is still being delivered', async () => {
    const f = await deliveredFirstPayment()
    await pool.query("UPDATE orders SET fulfillment_state='queued' WHERE id=$1", [f.order])
    await expect(askRefund(f.invoice)).rejects.toMatchObject({ status: 409, code: 'fulfillment_pending' })
    expect(await notesOf(f.invoice)).toHaveLength(0)
  })
  // ---- Vendor-requested refund of a card payment, made by the system through the provider ----
  /** A delivered first payment whose attempt is a real payment inside the simulator, so the refund worker can look it up and refund it. */
  async function simulatorPaid() {
    const f = await deliveredFirstPayment({ provider: 'simulator', mode: 'simulator' })
    const adapter = new SimulatorAdapter()
    const created = await adapter.createAttempt({ attempt_id: f.attempt, order_id: f.order, amount: { minor: f.total, currency: 'SAR', exponent: 2 },
      description: 'x', success_url: '', back_url: '', callback_url: '' })
    adapter.settle(created.provider_ref)
    await pool.query('UPDATE payment_attempts SET provider_ref=$2 WHERE id=$1', [f.attempt, created.provider_ref])
    return { ...f, adapter, ref: created.provider_ref }
  }
  const refundRows = async (order: string) => (await pool.query("SELECT status,attempts,payload FROM commercial_outbox WHERE kind='reconcile.refund' AND aggregate_id=$1", [order])).rows
  const vendorNoteOf = async (invoice: string) => (await pool.query("SELECT * FROM invoice_adjustments WHERE invoice_id=$1 AND origin='vendor'", [invoice])).rows
  const refundAudits = async (note: string) => (await pool.query("SELECT * FROM audit_events WHERE subject=$1 AND action='invoice.credit_refunded'", [note])).rows
  const providerPayment = (f: { adapter: SimulatorAdapter; ref: string }) => f.adapter.lookupAttempt(f.ref)

  it('refunds a provider-paid first invoice through the provider with one call, records the provider reference and arms the lock once', async () => {
    const f = await simulatorPaid()
    const refund = vi.spyOn(f.adapter, 'refund')
    const note = await askRefund(f.invoice)
    // The request alone queues the refund and moves no money; the vendor page is told manual recording is not allowed.
    expect((await refundRows(f.order))).toEqual([expect.objectContaining({ status: 'pending', payload: expect.objectContaining({ adjustment_id: note.id, automatic: true, requested_by: operator }) })])
    expect((await providerPayment(f)).refunded).toBeUndefined()
    const pending = (await getVendorInvoice(pool, f.invoice))!.adjustments[0]!
    expect(pending).toMatchObject({ status: 'pending', automatic_refund: { state: 'in_progress' }, manual_record_allowed: false })
    await expect(recordRef(note.id, 'BY-HAND')).rejects.toMatchObject({ status: 409, code: 'refund_in_progress' })
    expect(await processRefundOutbox(pool, f.adapter)).toBe(1)
    expect(refund).toHaveBeenCalledTimes(1)
    expect(refund).toHaveBeenCalledWith(expect.any(String), { minor: f.total, currency: 'SAR', exponent: 2 })
    const [stored] = await vendorNoteOf(f.invoice)
    expect(stored).toMatchObject({ id: note.id, status: 'refunded', refunded_by: 'system' })
    expect(stored.refund_reference).toMatch(/^sim_pay_/)
    expect(await refundRows(f.order)).toEqual([expect.objectContaining({ status: 'done' })])
    // The operator who asked is the actor of the audit; the system step is named in its metadata.
    expect(await refundAudits(note.id)).toEqual([expect.objectContaining({ actor: 'vendor-test:7', metadata: expect.objectContaining({ automatic: true, executed_by: 'system', external_reference: stored.refund_reference }) })])
    expect(await lockOf(f.sub)).toMatchObject({ cause: 'refund', state: 'pending' })
    expect(await lockAudits(f.sub)).toEqual([expect.objectContaining({ actor: 'vendor-test:7' })])
    expect((await getVendorInvoice(pool, f.invoice))!.adjustments[0]).toMatchObject({ automatic_refund: { state: 'done' }, manual_record_allowed: false })
    // A later pass does nothing, and neither does the form: the money is back.
    expect(await processRefundOutbox(pool, f.adapter)).toBe(0)
    await expect(recordRef(note.id, 'AFTER')).rejects.toMatchObject({ status: 409, code: 'credit_note_not_pending' })
    expect(refund).toHaveBeenCalledTimes(1)
  })

  it('makes one provider refund however many times the request is repeated, two workers run, or the worker restarts', async () => {
    const f = await simulatorPaid()
    const refund = vi.spyOn(f.adapter, 'refund')
    const [first, second] = await Promise.allSettled([askRefund(f.invoice), askRefund(f.invoice)])
    expect([first!.status, second!.status].sort()).toEqual(['fulfilled', 'rejected'])
    await expect(askRefund(f.invoice)).rejects.toMatchObject({ status: 409, code: 'refund_already_requested' })
    expect(await refundRows(f.order)).toHaveLength(1)
    await Promise.all([processRefundOutbox(pool, f.adapter), processRefundOutbox(pool, f.adapter)])
    // A worker that died after the provider refunded and before the note was recorded: the retry asks the provider for nothing more.
    await processRefundOutbox(pool, f.adapter)
    expect(refund).toHaveBeenCalledTimes(1)
    expect(await vendorNoteOf(f.invoice)).toEqual([expect.objectContaining({ status: 'refunded' })])
    expect(await lockAudits(f.sub)).toHaveLength(1)
  })

  it('finishes recording after a crash between the provider refund and the note, without refunding again', async () => {
    const f = await simulatorPaid()
    const refund = vi.spyOn(f.adapter, 'refund')
    await askRefund(f.invoice)
    // The provider already returned the whole payment (an earlier run that died before recording).
    await f.adapter.refund((await providerPayment(f)).payment_id!, { minor: f.total, currency: 'SAR', exponent: 2 })
    refund.mockClear()
    await processRefundOutbox(pool, f.adapter)
    expect(refund).not.toHaveBeenCalled()
    expect(await vendorNoteOf(f.invoice)).toEqual([expect.objectContaining({ status: 'refunded', refunded_by: 'system' })])
    expect(await lockAudits(f.sub)).toHaveLength(1)
  })

  it('adds no second note and no second lock when the provider reports the refund afterwards, in either order', async () => {
    const after = await simulatorPaid()
    await askRefund(after.invoice)
    await processRefundOutbox(pool, after.adapter)
    const event = await providerPayment(after)
    await applyConfirmedEvent(pool, { ...event, event_id: 'evt-after-1' })
    await processRefundOutbox(pool, after.adapter)
    expect(await notesOf(after.invoice)).toEqual([expect.objectContaining({ origin: 'vendor', status: 'refunded' })])
    expect(await lockAudits(after.sub)).toHaveLength(1)
    // The event arrives before the worker records: the pending vendor note already is that money.
    const before = await simulatorPaid()
    await askRefund(before.invoice)
    await before.adapter.refund((await providerPayment(before)).payment_id!, { minor: before.total, currency: 'SAR', exponent: 2 })
    await applyConfirmedEvent(pool, { ...(await providerPayment(before)), event_id: 'evt-before-1' })
    // The worker has not reached the refund row yet (it is leased for later): only the provider's event is processed.
    await pool.query("UPDATE commercial_outbox SET next_attempt_at=now() + interval '1 hour' WHERE kind='reconcile.refund' AND aggregate_id=$1", [before.order])
    await processRefundOutbox(pool, before.adapter)
    expect(await notesOf(before.invoice)).toEqual([expect.objectContaining({ origin: 'vendor', status: 'pending' })])
    await pool.query("UPDATE commercial_outbox SET next_attempt_at=now() WHERE kind='reconcile.refund' AND aggregate_id=$1", [before.order])
    await processRefundOutbox(pool, before.adapter)
    expect(await notesOf(before.invoice)).toEqual([expect.objectContaining({ origin: 'vendor', status: 'refunded' })])
    expect(await lockAudits(before.sub)).toHaveLength(1)
  })

  it('leaves the note pending when the provider cannot refund, shows the failure, and only then lets the operator record it by hand', async () => {
    const f = await simulatorPaid()
    await pool.query("UPDATE payment_attempts SET provider='moyasar',mode='live' WHERE id=$1", [f.attempt]) // another provider than the configured adapter
    const note = await askRefund(f.invoice)
    await processRefundOutbox(pool, f.adapter)
    expect(await refundRows(f.order)).toEqual([expect.objectContaining({ status: 'failed', payload: expect.objectContaining({ error: 'provider_refund_unavailable' }) })])
    expect((await vendorNoteOf(f.invoice))[0]).toMatchObject({ id: note.id, status: 'pending' })
    expect(await notesOf(f.invoice)).toHaveLength(1)
    expect((await attention(pool, true)).items.filter(i => i.kind === 'refund_rejected' && i.customer_id === f.customer)).toHaveLength(1)
    expect((await getVendorInvoice(pool, f.invoice))!.adjustments[0]).toMatchObject({ status: 'pending', automatic_refund: { state: 'failed', reason: 'provider_refund_unavailable' }, manual_record_allowed: true })
    await expect(recordRef(note.id, 'MANUAL-1')).resolves.toMatchObject({ status: 'refunded', refund_reference: 'MANUAL-1', refunded_by: 'vendor-test:7' })
    expect(await lockOf(f.sub)).toMatchObject({ cause: 'refund' })
    expect((await attention(pool, true)).items.filter(i => i.kind === 'refund_rejected' && i.customer_id === f.customer)).toHaveLength(0)
  })

  it('keeps a bank-transfer-paid invoice manual: no provider refund is queued', async () => {
    const f = await deliveredFirstPayment({ provider: 'bank_transfer' })
    const note = await askRefund(f.invoice)
    expect(await refundRows(f.order)).toHaveLength(0)
    expect((await getVendorInvoice(pool, f.invoice))!.adjustments[0]).toMatchObject({ automatic_refund: null, manual_record_allowed: true })
    await expect(recordRef(note.id, 'TRF-RETURN-1')).resolves.toMatchObject({ status: 'refunded' })
  })

  it('still refuses a payment that is not the customer\'s first, and queues nothing for it', async () => {
    const f = await simulatorPaid()
    const second = randomUUID(), secondOrder = randomUUID(), secondAttempt = randomUUID()
    await pool.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
      VALUES($1,$2,$3,'change',$4,$5,'paid','applied',$6,'fixture',5000,'SAR',2)`, [secondOrder, f.customer, f.sub, randomUUID(), f.revision, randomUUID()])
    await pool.query(`INSERT INTO invoices(id,customer_id,subscription_id,order_id,kind,status,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,due_at,paid_at)
      VALUES($1,$2,$3,$4,'change','paid','SAR',2,5000,0,5000,'2026-01-10','2026-02-01',now(),now())`, [second, f.customer, f.sub, secondOrder])
    await pool.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status,succeeded_at)
      VALUES($1,$2,$3,'moyasar','live',$4,5000,'SAR',2,'succeeded',now() + interval '1 day')`, [secondAttempt, secondOrder, second, `moy-${secondAttempt}`])
    await pool.query('UPDATE orders SET paid_attempt_id=$2 WHERE id=$1', [secondOrder, secondAttempt])
    await expect(askRefund(second)).rejects.toMatchObject({ status: 409, code: 'refund_not_first_payment' })
    expect(await refundRows(secondOrder)).toHaveLength(0)
  })
  it('makes no provider call when the note was voided or recorded by hand before the worker ran', async () => {
    const voided = await simulatorPaid()
    const refundVoided = vi.spyOn(voided.adapter, 'refund')
    const voidedNote = await askRefund(voided.invoice)
    await pool.query("UPDATE invoice_adjustments SET status='void' WHERE id=$1", [voidedNote.id])
    await processRefundOutbox(pool, voided.adapter)
    expect(refundVoided).not.toHaveBeenCalled()
    expect((await providerPayment(voided)).refunded).toBeUndefined()
    expect(await refundRows(voided.order)).toEqual([expect.objectContaining({ status: 'failed', payload: expect.objectContaining({ error: 'refund_note_unavailable' }) })])
    expect(await lockOf(voided.sub)).toBeUndefined()
    // Recorded by hand (the row was failed or removed first): the row closes as done and the provider is not asked.
    const recorded = await simulatorPaid()
    const refundRecorded = vi.spyOn(recorded.adapter, 'refund')
    const recordedNote = await askRefund(recorded.invoice)
    await pool.query("UPDATE invoice_adjustments SET status='refunded',refund_reference='BY-HAND',refunded_by='vendor-test:7',refunded_at=now() WHERE id=$1", [recordedNote.id])
    await processRefundOutbox(pool, recorded.adapter)
    expect(refundRecorded).not.toHaveBeenCalled()
    expect(await refundRows(recorded.order)).toEqual([expect.objectContaining({ status: 'done' })])
  })

  it('keeps the row retryable when the lock is already ordered after the provider refunded, and records it once the delivery settles', async () => {
    const f = await simulatorPaid()
    const refund = vi.spyOn(f.adapter, 'refund')
    const note = await askRefund(f.invoice)
    await pool.query(`INSERT INTO free_base_locks(subscription_id,pre_lock_revision_id,period_start,trial_ended_at,cause,state,order_id)
      VALUES($1,$2,'2026-01-01',now(),'trial_end','ordered',$3)`, [f.sub, f.revision, f.order])
    await processRefundOutbox(pool, f.adapter)
    // The provider returned the money; recording was refused and rolled back, so the row waits for a retry.
    expect(refund).toHaveBeenCalledTimes(1)
    expect(await refundRows(f.order)).toEqual([expect.objectContaining({ status: 'pending', attempts: 1, payload: expect.objectContaining({ error: 'lock_pending', provider_refund: 'returned', provider_payment_id: expect.stringMatching(/^sim_pay_/) }) })])
    expect((await vendorNoteOf(f.invoice))[0]).toMatchObject({ id: note.id, status: 'pending' })
    expect((await getVendorInvoice(pool, f.invoice))!.adjustments[0]).toMatchObject({ automatic_refund: { state: 'refunded_recording', reason: 'lock_pending' }, manual_record_allowed: false })
    await pool.query('DELETE FROM free_base_locks WHERE subscription_id=$1', [f.sub])
    await pool.query("UPDATE commercial_outbox SET next_attempt_at=now() WHERE aggregate_id=$1", [f.order])
    await processRefundOutbox(pool, f.adapter)
    expect(refund).toHaveBeenCalledTimes(1)
    expect((await vendorNoteOf(f.invoice))[0]).toMatchObject({ status: 'refunded', refunded_by: 'system' })
    expect(await refundRows(f.order)).toEqual([expect.objectContaining({ status: 'done' })])
    expect(await lockAudits(f.sub)).toHaveLength(1)
  })
  /** Orders a free-base lock on the subscription so recording the refund is refused with `lock_pending`, and runs the worker `runs` more times past the hand-off limit. */
  const blockRecording = (f: { sub: string; revision: string; order: string }) => pool.query(`INSERT INTO free_base_locks(subscription_id,pre_lock_revision_id,period_start,trial_ended_at,cause,state,order_id)
    VALUES($1,$2,'2026-01-01',now(),'trial_end','ordered',$3)`, [f.sub, f.revision, f.order])
  const runAgain = async (f: { adapter: SimulatorAdapter; order: string }, times: number) => {
    for (let i = 0; i < times; i++) {
      await pool.query('UPDATE commercial_outbox SET next_attempt_at=now() WHERE aggregate_id=$1', [f.order])
      await processRefundOutbox(pool, f.adapter)
    }
  }
  const noMoreOperatorRecord = async (f: { invoice: string }, note: string) => {
    expect((await getVendorInvoice(pool, f.invoice))!.adjustments[0]!.manual_record_allowed).toBe(false)
    await expect(recordRef(note, 'BY-HAND-2')).rejects.toMatchObject({ status: 409, code: 'refund_in_progress' })
  }

  it('never hands the row to the operator while the provider has returned the money, however long recording stays blocked', async () => {
    const f = await simulatorPaid()
    const refund = vi.spyOn(f.adapter, 'refund')
    const note = await askRefund(f.invoice)
    await blockRecording(f)
    await runAgain(f, 9) // more than the six tries before the hand-off
    expect(refund).toHaveBeenCalledTimes(1)
    expect(await refundRows(f.order)).toEqual([expect.objectContaining({ status: 'pending', payload: expect.objectContaining({ provider_refund: 'returned', error: 'lock_pending' }) })])
    expect((await getVendorInvoice(pool, f.invoice))!.adjustments[0]).toMatchObject({ status: 'pending', automatic_refund: { state: 'refunded_recording', reason: 'lock_pending' }, manual_record_allowed: false })
    await noMoreOperatorRecord(f, note.id)
    expect((await attention(pool, true)).items.filter(i => i.kind === 'refund_rejected' && i.customer_id === f.customer)).toHaveLength(0)
    await pool.query('DELETE FROM free_base_locks WHERE subscription_id=$1', [f.sub])
    await runAgain(f, 1)
    expect(refund).toHaveBeenCalledTimes(1)
    expect((await vendorNoteOf(f.invoice))[0]).toMatchObject({ status: 'refunded', refunded_by: 'system' })
    expect(await refundRows(f.order)).toEqual([expect.objectContaining({ status: 'done' })])
    expect(await lockAudits(f.sub)).toHaveLength(1)
  })

  it('keeps the same protection when the worker died after the provider refunded and recording then keeps failing', async () => {
    const f = await simulatorPaid()
    const refund = vi.spyOn(f.adapter, 'refund')
    const note = await askRefund(f.invoice)
    // The earlier run died right after the provider call: the provider shows the whole payment returned, the row carries nothing.
    await f.adapter.refund((await providerPayment(f)).payment_id!, { minor: f.total, currency: 'SAR', exponent: 2 })
    refund.mockClear()
    await blockRecording(f)
    await pool.query('UPDATE commercial_outbox SET attempts=5 WHERE aggregate_id=$1', [f.order])
    await runAgain(f, 3)
    expect(refund).not.toHaveBeenCalled()
    expect(await refundRows(f.order)).toEqual([expect.objectContaining({ status: 'pending', payload: expect.objectContaining({ provider_refund: 'returned' }) })])
    await noMoreOperatorRecord(f, note.id)
    await pool.query('DELETE FROM free_base_locks WHERE subscription_id=$1', [f.sub])
    await runAgain(f, 1)
    expect(await vendorNoteOf(f.invoice)).toEqual([expect.objectContaining({ status: 'refunded' })])
    expect(refund).not.toHaveBeenCalled()
  })

  it('records from the persisted fact without the provider, even with no payment adapter configured', async () => {
    const f = await simulatorPaid()
    await askRefund(f.invoice)
    await blockRecording(f)
    await processRefundOutbox(pool, f.adapter)
    await pool.query('DELETE FROM free_base_locks WHERE subscription_id=$1', [f.sub])
    await pool.query('UPDATE commercial_outbox SET next_attempt_at=now() WHERE aggregate_id=$1', [f.order])
    await processRefundOutbox(pool)
    expect((await vendorNoteOf(f.invoice))[0]).toMatchObject({ status: 'refunded', refunded_by: 'system' })
  })

  it('lets the operator take over when the provider call failed and the provider proves nothing was returned', async () => {
    const f = await simulatorPaid()
    const refund = vi.spyOn(f.adapter, 'refund').mockRejectedValue(new PaymentError('provider_error', 'http 422'))
    const note = await askRefund(f.invoice)
    await pool.query('UPDATE commercial_outbox SET attempts=5 WHERE aggregate_id=$1', [f.order])
    await processRefundOutbox(pool, f.adapter)
    expect(refund).toHaveBeenCalledTimes(1)
    const [row] = await refundRows(f.order)
    expect(row).toMatchObject({ status: 'failed' })
    expect(row.payload.provider_refund).toBeUndefined()
    expect((await getVendorInvoice(pool, f.invoice))!.adjustments[0]).toMatchObject({ status: 'pending', automatic_refund: { state: 'failed' }, manual_record_allowed: true })
    await expect(recordRef(note.id, 'MANUAL-2')).resolves.toMatchObject({ status: 'refunded', refund_reference: 'MANUAL-2' })
    expect(await lockOf(f.sub)).toMatchObject({ cause: 'refund' })
  })

  it('cannot lead to a second payment when the refund call has an unknown outcome: the row waits, the form is closed, the provider settles it', async () => {
    const f = await simulatorPaid()
    const note = await askRefund(f.invoice)
    const refund = vi.spyOn(f.adapter, 'refund').mockImplementation(async () => {
      vi.spyOn(f.adapter, 'lookupAttempt').mockRejectedValue(new PaymentError('timeout', 'lookup'))
      throw new PaymentError('timeout', 'refund')
    })
    await pool.query('UPDATE commercial_outbox SET attempts=5 WHERE aggregate_id=$1', [f.order])
    await runAgain(f, 3) // the hand-off limit is passed while the provider stays unreadable
    expect(refund).toHaveBeenCalledTimes(1)
    expect(await refundRows(f.order)).toEqual([expect.objectContaining({ status: 'pending', payload: expect.objectContaining({ provider_refund: 'attempted' }) })])
    expect((await getVendorInvoice(pool, f.invoice))!.adjustments[0]).toMatchObject({ status: 'pending', automatic_refund: { state: 'provider_unverified' }, manual_record_allowed: false })
    await noMoreOperatorRecord(f, note.id)
    // The provider did return the money (the operator sees it in the dashboard): the worker's next read finds it and records it, with no second call.
    vi.restoreAllMocks()
    await f.adapter.refund((await providerPayment(f)).payment_id!, { minor: f.total, currency: 'SAR', exponent: 2 })
    const again = vi.spyOn(f.adapter, 'refund')
    await runAgain(f, 1)
    expect(again).not.toHaveBeenCalled()
    expect((await vendorNoteOf(f.invoice))[0]).toMatchObject({ status: 'refunded', refunded_by: 'system' })
  })
})
