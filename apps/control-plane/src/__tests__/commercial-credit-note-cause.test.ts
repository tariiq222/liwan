import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { transaction } from '../db.js'
import { creditedMinorSql } from '../commercial/refund-credit.js'
import { processRefundOutbox, requestInvoiceRefund } from '../commercial/settlements.js'
import { enqueueOutbox } from '../commercial/outbox.js'
import { vendorActorIssuer } from '../admin-auth/grants.js'
import { setup, url } from './commercial-helpers.js'

const suite = url ? describe : describe.skip
const DUPLICATE_TEXT = 'duplicate payment — manual review'

suite('the kind of a credit note is its typed cause, never its wording (AUDIT-040)', () => {
  const pool = new Pool({ connectionString: url, max: 4 })
  const actor = { issuer: vendorActorIssuer(`cause-${randomUUID()}`), actorUid: 7 }
  beforeAll(async () => { await setup(pool) })
  beforeEach(async () => { await pool.query('TRUNCATE customers CASCADE'); await pool.query('TRUNCATE commercial_outbox') })
  afterAll(async () => { await pool.end() })

  async function paidInvoice() {
    const customer = randomUUID(), sub = randomUUID(), revision = randomUUID(), order = randomUUID(), invoice = randomUUID(), attempt = randomUUID()
    await transaction(pool, async c => {
      await c.query('INSERT INTO customers(id,name) VALUES($1,$2)', [customer, 'Cause test'])
      await c.query('INSERT INTO subscriptions(id,customer_id) VALUES($1,$2)', [sub, customer])
      await c.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)', [revision, sub, '{}', randomUUID()])
      await c.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
        VALUES($1,$2,$3,'new',$4,$5,'paid','applied',$6,'fixture',11500,'SAR',2)`, [order, customer, sub, randomUUID(), revision, randomUUID()])
      await c.query(`INSERT INTO invoices(id,customer_id,subscription_id,order_id,kind,status,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,due_at)
        VALUES($1,$2,$3,$4,'initial','paid','SAR',2,10000,1500,11500,'2026-01-01','2026-02-01',now())`, [invoice, customer, sub, order])
      await c.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status,succeeded_at)
        VALUES($1,$2,$3,'moyasar','live',$4,11500,'SAR',2,'succeeded',now())`, [attempt, order, invoice, `moy-${attempt}`])
      await c.query('UPDATE orders SET paid_attempt_id=$2 WHERE id=$1', [order, attempt])
    })
    return { customer, order, invoice, attempt }
  }
  const credited = async (invoice: string) => Number((await pool.query(`SELECT ${creditedMinorSql('$1')} AS amount`, [invoice])).rows[0].amount)

  it('an operator reason that starts with the duplicate-charge text is still the operator refund and counts as credited', async () => {
    const f = await paidInvoice()
    const note = await requestInvoiceRefund(pool, { invoice_id: f.invoice, actor, reason: `${DUPLICATE_TEXT} typed by the operator` })
    expect((await pool.query('SELECT origin,cause FROM invoice_adjustments WHERE id=$1', [note.id])).rows[0]).toEqual({ origin: 'vendor', cause: 'vendor_refund' })
    expect(await credited(f.invoice)).toBe(11500)
  })
  it('an operator reason equal to the provider-refund text neither hides nor replaces the provider refund note', async () => {
    const f = await paidInvoice()
    await requestInvoiceRefund(pool, { invoice_id: f.invoice, actor, reason: 'payment refunded after fulfillment — manual review (attempt x)' })
    // The vendor note is the whole invoice, so the provider's event adds nothing; the request must not be taken for a provider note either.
    await enqueueOutbox(pool as any, { kind: 'payment.intervention', aggregate_id: f.order, dedupe_key: `${f.attempt}:11500`,
      payload: { order_id: f.order, attempt_id: f.attempt, refunded: { minor: 11500, currency: 'SAR', exponent: 2 } } })
    await processRefundOutbox(pool)
    const notes = (await pool.query('SELECT origin,cause FROM invoice_adjustments WHERE invoice_id=$1', [f.invoice])).rows
    expect(notes).toEqual([{ origin: 'vendor', cause: 'vendor_refund' }])
  })
  it('a provider refund after fulfillment is a provider_refund note and the operator request attaches to it', async () => {
    const f = await paidInvoice()
    await enqueueOutbox(pool as any, { kind: 'payment.intervention', aggregate_id: f.order, dedupe_key: `${f.attempt}:11500`,
      payload: { order_id: f.order, attempt_id: f.attempt, refunded: { minor: 11500, currency: 'SAR', exponent: 2 } } })
    await processRefundOutbox(pool)
    const [note] = (await pool.query('SELECT id,cause,origin FROM invoice_adjustments WHERE invoice_id=$1', [f.invoice])).rows
    expect(note).toMatchObject({ cause: 'provider_refund', origin: 'system' })
    expect(await requestInvoiceRefund(pool, { invoice_id: f.invoice, actor, reason: 'Customer asked' })).toMatchObject({ id: note.id })
  })
  it('a duplicate charge is a duplicate_payment note that credits nothing on the invoice', async () => {
    const f = await paidInvoice()
    await enqueueOutbox(pool as any, { kind: 'reconcile.refund', aggregate_id: f.order, dedupe_key: `dup:${f.attempt}`, payload: { attempt_id: f.attempt, duplicate: true } })
    await processRefundOutbox(pool)
    expect((await pool.query('SELECT cause FROM invoice_adjustments WHERE invoice_id=$1', [f.invoice])).rows).toEqual([{ cause: 'duplicate_payment' }])
    expect(await credited(f.invoice)).toBe(0)
  })
  it('the database refuses a cause that contradicts the origin', async () => {
    const f = await paidInvoice()
    const insert = (origin: string, cause: string | null) => pool.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin,cause)
      VALUES($1,$2,$3,'credit_note','x note',100,'SAR',2,'pending','t',$4,$5)`, [randomUUID(), f.invoice, f.customer, origin, cause])
    await expect(insert('system', 'vendor_refund')).rejects.toMatchObject({ constraint: 'invoice_adjustments_cause_origin' })
    await expect(insert('vendor', 'duplicate_payment')).rejects.toMatchObject({ constraint: 'invoice_adjustments_cause_origin' })
    await expect(insert('system', 'made_up')).rejects.toMatchObject({ constraint: 'invoice_adjustments_cause' })
    await expect(insert('system', null)).rejects.toMatchObject({ code: '23502' })
  })
  it('schema 047 carries every existing credit note to its cause from the old prefixes', async () => {
    const f = await paidInvoice()
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      await c.query('ALTER TABLE invoice_adjustments DROP COLUMN cause')
      const legacy = async (reason: string, createdBy: string, origin: string) => {
        const id = randomUUID()
        await c.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin)
          VALUES($1,$2,$3,'credit_note',$4,100,'SAR',2,'pending',$5,$6)`, [id, f.invoice, f.customer, reason, createdBy, origin])
        return id
      }
      const expected: Array<[string, string]> = [
        [await legacy('Customer asked for it back', 'vendor:7', 'vendor'), 'vendor_refund'],
        [await legacy(`${DUPLICATE_TEXT} (attempt a)`, 'system', 'system'), 'duplicate_payment'],
        [await legacy('payment refunded after fulfillment — manual review (attempt a)', 'system', 'system'), 'provider_refund'],
        [await legacy('payment after cancellation — manual review', 'system', 'system'), 'payment_after_cancellation'],
        [await legacy('Payment returned after an undelivered trial order', 'system', 'system'), 'automatic_refund'],
        [await legacy('Fulfillment failed permanently', 'commercial-fulfillment', 'system'), 'fulfillment_failure'],
        [await legacy('ai_balance_limit_exceeded', 'test', 'system'), 'fulfillment_failure'],
        // An operator's wording on a vendor note never makes it a system kind.
        [await legacy(`${DUPLICATE_TEXT} typed by the operator`, 'vendor:7', 'vendor'), 'vendor_refund']]
      await c.query(await readFile(new URL('../schema_047.sql', import.meta.url), 'utf8'))
      const rows = (await c.query('SELECT id,cause FROM invoice_adjustments WHERE id=ANY($1::uuid[])', [expected.map(e => e[0])])).rows
      expect(expected.map(([id, cause]) => [cause, rows.find(r => r.id === id)?.cause])).toEqual(expected.map(([, cause]) => [cause, cause]))
    } finally { await c.query('ROLLBACK'); c.release() }
  })
})
