import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { getVendorInvoice } from '../commercial/invoices.js'
import { processRefundOutbox } from '../commercial/settlements.js'
import { setup, url } from './commercial-helpers.js'
import { stuckRefundFixtures } from './stuck-refund-fixtures.js'

const suite = url ? describe : describe.skip
suite('the vendor invoice view of a stuck automatic refund on PostgreSQL', () => {
  const pool = new Pool({ connectionString: url, max: 6 })
  const fx = stuckRefundFixtures(pool)
  beforeAll(async () => { await setup(pool) })
  beforeEach(async () => { await pool.query('TRUNCATE customers CASCADE'); await pool.query('TRUNCATE commercial_outbox') })
  afterEach(() => { vi.restoreAllMocks() })
  afterAll(async () => { await pool.end() })
  const automatic = async (invoice: string, note: string) => (await getVendorInvoice(pool, invoice))!.adjustments.find(a => a.id === note)!.automatic_refund

  it('shows an attempted row with its age, tries, next try and the check and release actions', async () => {
    const f = await fx.attempted()
    const row = await fx.refundRow(f.order)
    expect(await automatic(f.invoice, f.note)).toEqual({ state: 'provider_unverified', reason: 'timeout: refund', stuck: {
      since: row.created_at.toISOString(), attempts: row.attempts, next_attempt_at: row.next_attempt_at.toISOString(), provider_payment_id: null,
      conflict: null, actions: ['check', 'release'], release_from: new Date(Date.parse(row.payload.attempted_at) + 60 * 60_000).toISOString() } })
  })

  it('shows a returned row with the payment id, the conflicting note on another invoice, and the check and record actions', async () => {
    const f = await fx.returnedInConflict()
    const view = await automatic(f.invoice, f.note)
    expect(view).toMatchObject({ state: 'refunded_recording', reason: 'refund_reference_in_use', stuck: { provider_payment_id: f.paymentId, actions: ['check', 'record'], release_from: null } })
    expect(view!.stuck!.conflict).toEqual({ adjustment_id: f.holder.note, invoice_id: f.holder.invoice, invoice_number: `INV-${f.holder.invoice.slice(0, 8)}`,
      amount: { currency: 'SAR', exponent: 2, minor: 11500 }, cause: 'provider_refund', status: 'refunded',
      refunded_by: 'vendor-test:9', refunded_at: expect.any(String), same_invoice: false })
  })

  it('marks a conflicting note of the same invoice', async () => {
    const f = await fx.returnedInConflict({ sameInvoice: true })
    expect((await automatic(f.invoice, f.note))!.stuck!.conflict).toMatchObject({ adjustment_id: f.holder.note, invoice_id: f.invoice, same_invoice: true })
  })

  it('shows a returned row that has no conflict with no conflict block', async () => {
    const f = await fx.simulatorPaid()
    const note = await fx.askRefund(f.invoice)
    await pool.query("UPDATE commercial_outbox SET payload=payload || jsonb_build_object('provider_refund','returned','provider_payment_id',$2::text,'error','refund_not_full') WHERE aggregate_id=$1", [f.order, f.paymentId])
    expect(await automatic(f.invoice, note.id)).toMatchObject({ state: 'refunded_recording', stuck: { conflict: null, provider_payment_id: f.paymentId, actions: ['check', 'record'] } })
  })

  it.each([
    ['in progress', async (f: Awaited<ReturnType<typeof fx.simulatorPaid>>) => { await fx.askRefund(f.invoice) }, 'in_progress'],
    ['done', async (f: Awaited<ReturnType<typeof fx.simulatorPaid>>) => { await fx.askRefund(f.invoice); await processRefundOutbox(pool, f.adapter) }, 'done'],
    ['failed', async (f: Awaited<ReturnType<typeof fx.simulatorPaid>>) => { await fx.askRefund(f.invoice); await processRefundOutbox(pool) }, 'failed'],
  ])('gives a %s refund no stuck fields and no actions', async (_name, arrange, state) => {
    const f = await fx.simulatorPaid()
    await arrange(f)
    const view = (await getVendorInvoice(pool, f.invoice))!.adjustments[0]!.automatic_refund
    expect(view).toMatchObject({ state, stuck: null })
  })

  it('gives a note with no automatic refund no automatic_refund at all', async () => {
    const f = await fx.simulatorPaid()
    await pool.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin,cause)
      VALUES(gen_random_uuid(),$1,$2,'credit_note','Fixture note',11500,'SAR',2,'pending','vendor-test','system','duplicate_payment')`, [f.invoice, f.customer])
    expect((await getVendorInvoice(pool, f.invoice))!.adjustments[0]!.automatic_refund).toBeNull()
  })
})
