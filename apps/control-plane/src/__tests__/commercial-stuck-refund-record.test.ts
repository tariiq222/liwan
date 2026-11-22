import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { getVendorInvoice } from '../commercial/invoices.js'
import { recordRefundIn, refundCreditNote } from '../commercial/settlements.js'
import { operator } from './stuck-refund-fixtures.js'
import { setup, url } from './commercial-helpers.js'
import { stuckRefundFixtures } from './stuck-refund-fixtures.js'
import { callStuckAction, holdOrderLock } from './stuck-refund-calls.js'

const suite = url ? describe : describe.skip
suite('record the returned refund of a stuck automatic refund on PostgreSQL', () => {
  const pool = new Pool({ connectionString: url, max: 8 })
  const fx = stuckRefundFixtures(pool)
  const call = callStuckAction(pool)
  const record = { reason: 'The provider already returned the money', resolution: 'record' }
  const duplicate = { reason: 'Another note already credits this money', resolution: 'already_recorded' }
  beforeAll(async () => { await setup(pool) })
  beforeEach(async () => { await pool.query('TRUNCATE customers CASCADE'); await pool.query('TRUNCATE commercial_outbox') })
  afterEach(() => { vi.restoreAllMocks() })
  afterAll(async () => { await pool.end() })
  const refundAudits = async (note: string) => (await pool.query("SELECT actor,reason,metadata FROM audit_events WHERE subject=$1 AND action='invoice.credit_refunded'", [note])).rows
  const closedAudits = async (note: string) => (await pool.query("SELECT actor,reason,metadata FROM audit_events WHERE subject=$1 AND action='payment.refund_duplicate_closed'", [note])).rows
  const lockOf = async (sub: string) => (await pool.query('SELECT * FROM free_base_locks WHERE subscription_id=$1', [sub])).rows[0]
  const lockAudits = async (sub: string) => (await pool.query("SELECT 1 FROM audit_events WHERE subject=$1 AND action='subscription.refund_lock_armed'", [sub])).rows
  const note = async (id: string) => (await pool.query('SELECT * FROM invoice_adjustments WHERE id=$1', [id])).rows[0]
  async function expectUntouched(f: { order: string; note: string; holder?: { note: string } }, before: { row: unknown; note: unknown; holder?: unknown }) {
    expect(await fx.refundRow(f.order)).toEqual(before.row)
    expect(await note(f.note)).toEqual(before.note)
    if (f.holder) expect(await note(f.holder.note)).toEqual(before.holder)
    expect(await refundAudits(f.note)).toHaveLength(0)
    expect(await closedAudits(f.note)).toHaveLength(0)
  }
  const snapshot = async (f: { order: string; note: string; holder?: { note: string } }) => ({ row: await fx.refundRow(f.order), note: await note(f.note), holder: f.holder ? await note(f.holder.note) : undefined })

  describe('record', () => {
    it('records the refund with the payment id and a short note id when another note holds the payment id, and finishes the row', async () => {
      const f = await fx.returnedInConflict()
      const holderBefore = await note(f.holder.note)
      const refund = vi.spyOn(f.adapter, 'refund')
      const result = await call(f.note, 'record', record, { adapter: f.adapter })
      const reference = `${f.paymentId}#${f.note.slice(0, 8)}`
      expect(result).toMatchObject({ status: 200, data: { provider: null, invoice: { id: f.invoice } } })
      expect(await note(f.note)).toMatchObject({ status: 'refunded', refund_reference: reference, refunded_by: 'vendor-test:7' })
      expect(await note(f.holder.note)).toEqual(holderBefore)
      expect(await fx.refundRow(f.order)).toMatchObject({ status: 'done' })
      expect(await refundAudits(f.note)).toEqual([expect.objectContaining({ actor: 'vendor-test:7', reason: record.reason,
        metadata: expect.objectContaining({ external_reference: reference, resolved_stuck: true, conflicting_adjustment_id: f.holder.note, invoice_id: f.invoice }) })])
      expect(refund).not.toHaveBeenCalled()
      expect((await getVendorInvoice(pool, f.invoice))!.adjustments[0]!.automatic_refund).toMatchObject({ state: 'done', stuck: null })
    })

    it('arms the free-base lock once, as the worker\'s own recording does', async () => {
      const f = await fx.returnedInConflict()
      await call(f.note, 'record', record, { adapter: f.adapter })
      expect(await lockOf(f.sub)).toMatchObject({ cause: 'refund', state: 'pending' })
      expect(await lockAudits(f.sub)).toHaveLength(1)
      await call(f.note, 'record', record, { adapter: f.adapter })
      expect(await lockAudits(f.sub)).toHaveLength(1)
    })

    it('records the plain payment id when no other note holds it', async () => {
      const f = await fx.returnedWithoutConflict()
      await call(f.note, 'record', record, { adapter: f.adapter })
      expect(await note(f.note)).toMatchObject({ status: 'refunded', refund_reference: f.paymentId })
      expect(await fx.refundRow(f.order)).toMatchObject({ status: 'done' })
    })

    it('settles the undelivered order and completes the order-level row, as the worker\'s own recording does', async () => {
      const f = await fx.undeliveredReturnedInConflict()
      expect(await fx.refundRow(f.order)).toMatchObject({ status: 'pending', payload: expect.objectContaining({ provider_refund: 'returned', error: 'refund_reference_in_use' }) })
      expect((await getVendorInvoice(pool, f.invoice))!.adjustments[0]!.automatic_refund!.stuck!.actions).toEqual(['check', 'record'])
      await call(f.note, 'record', record, { adapter: f.adapter })
      expect(await note(f.note)).toMatchObject({ status: 'refunded', refund_reference: `${f.paymentId}#${f.note.slice(0, 8)}` })
      expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1', [f.order])).rows[0].payment_state).toBe('refunded')
      expect(await fx.refundRow(f.order)).toMatchObject({ status: 'done' })
    })

    it('refuses with refund_over_credit when the invoice\'s refunded credit plus this note would exceed what was paid', async () => {
      const f = await fx.returnedInConflict({ sameInvoice: true })
      const before = await snapshot(f)
      await expect(call(f.note, 'record', record, { adapter: f.adapter })).rejects.toMatchObject({ status: 409, code: 'refund_over_credit' })
      await expectUntouched(f, before)
    })

    it('is idempotent: a second call finds the row done, returns the view and records nothing again', async () => {
      const f = await fx.returnedInConflict()
      await call(f.note, 'record', record, { adapter: f.adapter })
      const again = await call(f.note, 'record', { ...record, reason: 'A retry after a lost response' }, { adapter: f.adapter, actor: 8 })
      expect(again).toMatchObject({ status: 200, data: { provider: null } })
      expect(await refundAudits(f.note)).toHaveLength(1)
      expect(await note(f.note)).toMatchObject({ refunded_by: 'vendor-test:7' })
      await expect(call(f.note, 'record', duplicate, { adapter: f.adapter })).resolves.toMatchObject({ status: 200 })
      expect(await note(f.note)).toMatchObject({ status: 'refunded' })
      expect(await closedAudits(f.note)).toHaveLength(0)
    })

    it('leaves the row to the worker: it finds the row done and does nothing', async () => {
      const f = await fx.returnedInConflict()
      await call(f.note, 'record', record, { adapter: f.adapter })
      const refund = vi.spyOn(f.adapter, 'refund')
      await fx.runAgain(f)
      expect(refund).not.toHaveBeenCalled()
      expect(await fx.refundRow(f.order)).toMatchObject({ status: 'done' })
      expect(await refundAudits(f.note)).toHaveLength(1)
    })
  })

  describe('already_recorded', () => {
    it('voids the stuck note and completes the row when a note of the same invoice already credits this money', async () => {
      const f = await fx.returnedInConflict({ sameInvoice: true })
      const holderBefore = await note(f.holder.note)
      const result = await call(f.note, 'record', duplicate, { adapter: f.adapter })
      expect(result).toMatchObject({ status: 200, data: { invoice: { id: f.invoice } } })
      expect(await note(f.note)).toMatchObject({ status: 'void', refund_reference: null })
      expect(await note(f.holder.note)).toEqual(holderBefore)
      expect(await fx.refundRow(f.order)).toMatchObject({ status: 'done' })
      expect(await closedAudits(f.note)).toEqual([expect.objectContaining({ actor: 'vendor-test:7', reason: duplicate.reason,
        metadata: expect.objectContaining({ conflicting_adjustment_id: f.holder.note, payment_id: f.paymentId, invoice_id: f.invoice }) })])
      expect(await refundAudits(f.note)).toHaveLength(0)
      expect(await lockOf(f.sub)).toBeUndefined()
    })

    it('settles the undelivered order when the note it voids was the one that kept it refund_pending', async () => {
      const f = await fx.undeliveredReturnedInConflict()
      await pool.query('UPDATE invoice_adjustments SET invoice_id=$2,customer_id=$3 WHERE id=$1', [f.holder.note, f.invoice, f.customer])
      await call(f.note, 'record', duplicate, { adapter: f.adapter })
      expect(await note(f.note)).toMatchObject({ status: 'void' })
      expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1', [f.order])).rows[0].payment_state).toBe('refunded')
      expect(await fx.refundRow(f.order)).toMatchObject({ status: 'done' })
    })

    it('is refused with refund_not_duplicate when the holder is a duplicate-payment note, which the invoice\'s credit does not count', async () => {
      const f = await fx.returnedInConflict({ sameInvoice: true })
      await pool.query("UPDATE invoice_adjustments SET cause='duplicate_payment' WHERE id=$1", [f.holder.note])
      const before = await snapshot(f)
      await expect(call(f.note, 'record', duplicate, { adapter: f.adapter })).rejects.toMatchObject({ status: 409, code: 'refund_not_duplicate' })
      await expectUntouched(f, before)
    })

    it('is refused with refund_not_duplicate when the holder is in another currency than the stuck note', async () => {
      const f = await fx.returnedInConflict({ sameInvoice: true })
      await pool.query("UPDATE invoice_adjustments SET currency='USD' WHERE id=$1", [f.holder.note])
      const before = await snapshot(f)
      await expect(call(f.note, 'record', duplicate, { adapter: f.adapter })).rejects.toMatchObject({ status: 409, code: 'refund_not_duplicate' })
      await expectUntouched(f, before)
    })

    it.each([
      ['on another invoice', async () => fx.returnedInConflict()],
      ['that covers less than this note', async () => fx.returnedInConflict({ sameInvoice: true, holderMinor: 5000 })],
      ['that does not exist', async () => fx.returnedWithoutConflict()],
    ])('is refused with refund_not_duplicate when the conflicting note is %s', async (_name, arrange) => {
      const f = await arrange()
      const before = await snapshot(f)
      await expect(call(f.note, 'record', duplicate, { adapter: f.adapter })).rejects.toMatchObject({ status: 409, code: 'refund_not_duplicate' })
      await expectUntouched(f, before)
    })
  })

  describe('refusals', () => {
    it('serves only a returned row', async () => {
      const attempted = await fx.attempted()
      await expect(call(attempted.note, 'record', record, { adapter: attempted.adapter })).rejects.toMatchObject({ status: 409, code: 'refund_not_stuck' })
      const running = await fx.simulatorPaid()
      const pending = await fx.askRefund(running.invoice)
      await expect(call(pending.id, 'record', record, { adapter: running.adapter })).rejects.toMatchObject({ status: 409, code: 'refund_not_stuck' })
    })

    it('refuses a note that is not a pending credit note', async () => {
      const f = await fx.returnedInConflict()
      await pool.query("UPDATE invoice_adjustments SET status='void' WHERE id=$1", [f.note])
      const before = await snapshot(f)
      await expect(call(f.note, 'record', record, { adapter: f.adapter })).rejects.toMatchObject({ status: 409, code: 'credit_note_not_pending' })
      await expectUntouched(f, before)
    })

    it('refuses a note of an invoice that is not the paying attempt\'s', async () => {
      const f = await fx.returnedInConflict()
      const other = await fx.simulatorPaid()
      await pool.query('UPDATE invoice_adjustments SET invoice_id=$2 WHERE id=$1', [f.note, other.invoice])
      const before = await snapshot(f)
      await expect(call(f.note, 'record', record, { adapter: f.adapter })).rejects.toMatchObject({ status: 409, code: 'refund_note_unavailable' })
      await expectUntouched(f, before)
    })

    it('needs the billing grant, a fresh step-up, a reason of 3 to 1000 characters and a known resolution', async () => {
      const f = await fx.returnedInConflict()
      const before = await snapshot(f)
      await expect(call(f.note, 'record', record, { adapter: f.adapter, caps: ['vendor.read'] })).rejects.toMatchObject({ status: 403, code: 'forbidden' })
      await expect(call(f.note, 'record', record, { adapter: f.adapter, stepUp: false })).rejects.toMatchObject({ status: 403, code: 'step_up_required' })
      for (const bad of [{ ...record, reason: 'ab' }, { ...record, reason: 'x'.repeat(1001) }, { reason: record.reason }, { ...record, resolution: 'force' }, { ...record, reference: 'MY-OWN' }])
        await expect(call(f.note, 'record', bad, { adapter: f.adapter })).rejects.toMatchObject({ status: 422, code: 'invalid' })
      await expectUntouched(f, before)
    })

    it('needs no payment adapter: the returned mark came from a verified read', async () => {
      const f = await fx.returnedInConflict()
      await expect(call(f.note, 'record', record, {})).resolves.toMatchObject({ status: 200 })
      expect(await note(f.note)).toMatchObject({ status: 'refunded' })
    })
  })

  describe('races', () => {
    it('answers refund_in_progress while the worker holds the order\'s refund lock, and changes nothing', async () => {
      const f = await fx.returnedInConflict()
      const before = await snapshot(f)
      const held = await holdOrderLock(pool, f.order)
      try { await expect(call(f.note, 'record', record, { adapter: f.adapter })).rejects.toMatchObject({ status: 409, code: 'refund_in_progress' }) }
      finally { await held.release() }
      await expectUntouched(f, before)
    })

    /**
     * A second pending note of the invoice (a provider-refund note for part of it), which the operator's form records. Each note alone fits what the
     * invoice paid; the two together do not.
     */
    async function secondPendingNote(f: { invoice: string; customer: string }, minor = 5000) {
      const id = (await pool.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin,cause)
        VALUES(gen_random_uuid(),$1,$2,'credit_note','Provider refunded part of it',$3,'SAR',2,'pending','system','system','provider_refund') RETURNING id`, [f.invoice, f.customer, minor])).rows[0].id as string
      return id
    }
    const manualForm = { reason: 'Refunded by hand through the provider', external_reference: 'MANUAL-REF-1' }
    /** Holds a recording open (its note, the invoice-level lock and the writes) in a transaction of its own until `finish` commits it. */
    async function openRecording(noteId: string, request: { reason: string; external_reference: string }, automatic: boolean) {
      const client = await pool.connect()
      await client.query('BEGIN')
      await recordRefundIn(client, { adjustment_id: noteId, actor: operator, refundedBy: 'vendor-test:9', request, automatic })
      return { finish: async () => { await client.query('COMMIT'); client.release() } }
    }
    const settle = (ms = 400) => new Promise(resolve => setTimeout(resolve, ms))

    it('does not let the form record a second note of the invoice while the stuck note is being recorded: together they would credit more than was paid', async () => {
      const f = await fx.returnedInConflict()
      const other = await secondPendingNote(f)
      const open = await openRecording(f.note, { reason: record.reason, external_reference: `${f.paymentId}#${f.note.slice(0, 8)}` }, true)
      const form = refundCreditNote(pool, { adjustment_id: other, actor: operator, request: manualForm })
      const settled = form.then(() => 'recorded', (error: { code?: string }) => error.code)
      await settle()
      await open.finish()
      expect(await settled).toBe('refund_over_credit')
      expect(await note(other)).toMatchObject({ status: 'pending', refund_reference: null })
      expect(await note(f.note)).toMatchObject({ status: 'refunded' })
    })

    it('does not let the stuck note be recorded while the form records another note of the invoice', async () => {
      const f = await fx.returnedInConflict()
      const other = await secondPendingNote(f)
      const open = await openRecording(other, manualForm, false)
      const stuck = call(f.note, 'record', record, { adapter: f.adapter }).then(() => 'recorded', (error: { code?: string }) => error.code)
      await settle()
      await open.finish()
      expect(await stuck).toBe('refund_over_credit')
      expect(await note(f.note)).toMatchObject({ status: 'pending' })
      expect(await fx.refundRow(f.order)).toMatchObject({ status: 'pending' })
      expect(await note(other)).toMatchObject({ status: 'refunded' })
    })

    it('records once when two operators act together: the loser is refused or sees the finished view', async () => {
      const f = await fx.returnedInConflict()
      const outcomes = await Promise.allSettled([call(f.note, 'record', record, { adapter: f.adapter }), call(f.note, 'record', record, { adapter: f.adapter, actor: 8 })])
      for (const outcome of outcomes) if (outcome.status === 'rejected') expect(outcome.reason).toMatchObject({ status: 409, code: 'refund_in_progress' })
      expect(outcomes.some(outcome => outcome.status === 'fulfilled')).toBe(true)
      expect(await refundAudits(f.note)).toHaveLength(1)
      expect(await note(f.note)).toMatchObject({ status: 'refunded' })
    })
  })
})
