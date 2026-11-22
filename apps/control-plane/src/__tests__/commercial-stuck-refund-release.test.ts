import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { PaymentError } from '../commercial/payment-adapter.js'
import { processRefundOutbox } from '../commercial/settlements.js'
import { getVendorInvoice } from '../commercial/invoices.js'
import { setup, url } from './commercial-helpers.js'
import { stuckRefundFixtures } from './stuck-refund-fixtures.js'
import { callStuckAction, holdOrderLock } from './stuck-refund-calls.js'

const suite = url ? describe : describe.skip
suite('release the hold of a stuck automatic refund on PostgreSQL', () => {
  const pool = new Pool({ connectionString: url, max: 8 })
  const fx = stuckRefundFixtures(pool)
  const call = callStuckAction(pool)
  const body = { reason: 'The provider shows the refund state' }
  beforeAll(async () => { await setup(pool) })
  beforeEach(async () => { await pool.query('TRUNCATE customers CASCADE'); await pool.query('TRUNCATE commercial_outbox') })
  afterEach(() => { vi.restoreAllMocks() })
  afterAll(async () => { await pool.end() })
  const audits = async (note: string) => (await pool.query("SELECT actor,reason,metadata FROM audit_events WHERE subject=$1 AND action='payment.refund_hold_released'", [note])).rows
  /** Moves the mark back in time, as the 60 minutes the release waits for. */
  const age = (order: string, minutes = 120) => pool.query("UPDATE commercial_outbox SET payload=jsonb_set(payload,'{attempted_at}',to_jsonb($2::text)) WHERE aggregate_id=$1",
    [order, new Date(Date.now() - minutes * 60_000).toISOString()])
  const attemptedAndOld = async () => { const f = await fx.attempted(); await age(f.order); return f }
  /** The row and the note exactly as they were: a refusal changes nothing, calls no refund and writes no audit. */
  async function expectUntouched(f: { order: string; note: string; adapter: { refund: unknown } }, before: unknown, refund: { mock: { calls: unknown[] } }) {
    expect(await fx.refundRow(f.order)).toEqual(before)
    expect(refund.mock.calls).toHaveLength(0)
    expect(await audits(f.note)).toHaveLength(0)
  }

  it('marks the row returned when the provider shows the whole payment refunded, and the worker then records it with no second call', async () => {
    const f = await attemptedAndOld()
    await fx.refundWholePayment(f)
    const refund = vi.spyOn(f.adapter, 'refund')
    const result = await call(f.note, 'release', body, { adapter: f.adapter })
    expect(result).toMatchObject({ status: 200, data: { provider: { status: 'refunded', payment_id: f.paymentId }, invoice: { id: f.invoice } } })
    const row = await fx.refundRow(f.order)
    expect(row.payload).toMatchObject({ provider_refund: 'returned', provider_payment_id: f.paymentId })
    expect(row.payload.attempted_at).toBeUndefined()
    expect(row.next_attempt_at.getTime()).toBeLessThanOrEqual(Date.now())
    expect(await audits(f.note)).toEqual([expect.objectContaining({ actor: 'vendor-test:7', reason: body.reason, metadata: expect.objectContaining({ outcome: 'returned', payment_id: f.paymentId, provider_status: 'refunded', refunded_minor: f.total }) })])
    await processRefundOutbox(pool, f.adapter)
    expect(refund).not.toHaveBeenCalled()
    expect((await fx.notes(f.invoice))[0]).toMatchObject({ status: 'refunded', refunded_by: 'system' })
  })

  it('removes the mark and makes the row due when the provider shows nothing refunded; the worker then refunds once through its guarded path', async () => {
    const f = await attemptedAndOld()
    const refund = vi.spyOn(f.adapter, 'refund')
    const result = await call(f.note, 'release', body, { adapter: f.adapter })
    expect(result!.data).toMatchObject({ provider: { status: 'succeeded', refunded: null } })
    expect(refund).not.toHaveBeenCalled()
    const row = await fx.refundRow(f.order)
    expect(row.payload.provider_refund).toBeUndefined()
    expect(row.payload.attempted_at).toBeUndefined()
    expect(row.status).toBe('pending')
    expect(row.next_attempt_at.getTime()).toBeLessThanOrEqual(Date.now())
    expect(await audits(f.note)).toEqual([expect.objectContaining({ metadata: expect.objectContaining({ outcome: 'not_returned', provider_status: 'succeeded', refunded_minor: null }) })])
    expect((await getVendorInvoice(pool, f.invoice))!.adjustments[0]!.automatic_refund).toMatchObject({ state: 'in_progress', stuck: null })
    await processRefundOutbox(pool, f.adapter)
    expect(refund).toHaveBeenCalledTimes(1)
    expect((await fx.notes(f.invoice))[0]).toMatchObject({ status: 'refunded', refunded_by: 'system' })
  })

  it('hands the note to the manual form by the existing rules when the released refund then fails with the provider proving nothing returned', async () => {
    const f = await attemptedAndOld()
    await call(f.note, 'release', body, { adapter: f.adapter })
    await pool.query('UPDATE commercial_outbox SET attempts=5,next_attempt_at=now() WHERE aggregate_id=$1', [f.order])
    vi.spyOn(f.adapter, 'refund').mockRejectedValue(new PaymentError('provider_error', 'http 422'))
    await processRefundOutbox(pool, f.adapter)
    expect(await fx.refundRow(f.order)).toMatchObject({ status: 'failed' })
    expect((await getVendorInvoice(pool, f.invoice))!.adjustments[0]).toMatchObject({ automatic_refund: { state: 'failed' }, manual_record_allowed: true })
  })

  describe('refuses, and changes nothing, when the answer is not definitive', () => {
    it('has no payment adapter: provider_refund_unavailable', async () => {
      const f = await attemptedAndOld()
      const before = await fx.refundRow(f.order)
      const refund = vi.spyOn(f.adapter, 'refund')
      await expect(call(f.note, 'release', body, {})).rejects.toMatchObject({ status: 409, code: 'provider_refund_unavailable' })
      await expectUntouched(f, before, refund)
    })
    it('cannot read the payment: provider_status_unverified', async () => {
      const f = await attemptedAndOld()
      const before = await fx.refundRow(f.order)
      const refund = vi.spyOn(f.adapter, 'refund')
      vi.spyOn(f.adapter, 'lookupAttempt').mockRejectedValue(new PaymentError('timeout', 'lookup'))
      await expect(call(f.note, 'release', body, { adapter: f.adapter })).rejects.toMatchObject({ status: 409, code: 'provider_status_unverified' })
      await expectUntouched(f, before, refund)
    })
    it.each([
      ['another amount', "UPDATE payment_attempts SET amount_minor=amount_minor+100 WHERE order_id=$1"],
      ['another currency', "UPDATE payment_attempts SET currency='USD' WHERE order_id=$1"],
    ])('the payment is not the attempt\'s (%s): provider_status_unverified', async (_name, sql) => {
      const f = await attemptedAndOld()
      await pool.query(sql, [f.order])
      const before = await fx.refundRow(f.order)
      const refund = vi.spyOn(f.adapter, 'refund')
      await expect(call(f.note, 'release', body, { adapter: f.adapter })).rejects.toMatchObject({ status: 409, code: 'provider_status_unverified' })
      await expectUntouched(f, before, refund)
    })
    it('another merchant account or mode: provider_status_unverified', async () => {
      const f = await attemptedAndOld()
      const before = await fx.refundRow(f.order)
      const refund = vi.spyOn(f.adapter, 'refund')
      const real = f.adapter.lookupAttempt.bind(f.adapter)
      vi.spyOn(f.adapter, 'lookupAttempt').mockImplementation(async ref => ({ ...(await real(ref)), merchant_account: 'someone-else' }))
      await expect(call(f.note, 'release', body, { adapter: f.adapter })).rejects.toMatchObject({ status: 409, code: 'provider_status_unverified' })
      await expectUntouched(f, before, refund)
    })
    it('the status says refunded but there is no figure: provider_refund_amount_unverified', async () => {
      const f = await attemptedAndOld()
      const before = await fx.refundRow(f.order)
      const refund = vi.spyOn(f.adapter, 'refund')
      const real = f.adapter.lookupAttempt.bind(f.adapter)
      vi.spyOn(f.adapter, 'lookupAttempt').mockImplementation(async ref => ({ ...(await real(ref)), status: 'refunded' as const, refunded: undefined }))
      await expect(call(f.note, 'release', body, { adapter: f.adapter })).rejects.toMatchObject({ status: 409, code: 'provider_refund_amount_unverified' })
      await expectUntouched(f, before, refund)
    })
    it('a partial figure: provider_refund_partial, the worker keeps asking for the rest', async () => {
      const f = await attemptedAndOld()
      await f.adapter.refund(f.paymentId, { minor: 5000, currency: 'SAR', exponent: 2 })
      const before = await fx.refundRow(f.order)
      const refund = vi.spyOn(f.adapter, 'refund')
      await expect(call(f.note, 'release', body, { adapter: f.adapter })).rejects.toMatchObject({ status: 409, code: 'provider_refund_partial' })
      await expectUntouched(f, before, refund)
    })
    it('a figure above the payment or in another currency: provider_refund_amount_unverified', async () => {
      const f = await attemptedAndOld()
      const before = await fx.refundRow(f.order)
      const refund = vi.spyOn(f.adapter, 'refund')
      const real = f.adapter.lookupAttempt.bind(f.adapter)
      vi.spyOn(f.adapter, 'lookupAttempt').mockImplementation(async ref => ({ ...(await real(ref)), status: 'refunded' as const, refunded: { currency: 'USD', exponent: 2, minor: f.total } }))
      await expect(call(f.note, 'release', body, { adapter: f.adapter })).rejects.toMatchObject({ status: 409, code: 'provider_refund_amount_unverified' })
      await expectUntouched(f, before, refund)
    })
    it('the mark is younger than 60 minutes: refund_attempt_too_recent, even when the provider shows nothing refunded', async () => {
      const f = await fx.attempted()
      for (const minutes of [0, 59]) {
        await age(f.order, minutes)
        const before = await fx.refundRow(f.order)
        const refund = vi.spyOn(f.adapter, 'refund')
        await expect(call(f.note, 'release', body, { adapter: f.adapter })).rejects.toMatchObject({ status: 409, code: 'refund_attempt_too_recent' })
        await expectUntouched(f, before, refund)
      }
      await age(f.order, 61)
      await expect(call(f.note, 'release', body, { adapter: f.adapter })).resolves.toMatchObject({ status: 200 })
    })
    it('a row marked before attempted_at existed is as old as the row itself', async () => {
      const f = await fx.attempted()
      await pool.query("UPDATE commercial_outbox SET payload=payload - 'attempted_at' WHERE aggregate_id=$1", [f.order])
      await expect(call(f.note, 'release', body, { adapter: f.adapter })).rejects.toMatchObject({ status: 409, code: 'refund_attempt_too_recent' })
      await pool.query("UPDATE commercial_outbox SET created_at=now() - interval '3 hours' WHERE aggregate_id=$1", [f.order])
      await expect(call(f.note, 'release', body, { adapter: f.adapter })).resolves.toMatchObject({ status: 200 })
    })
    it('the order moved on: refund_attempt_unavailable', async () => {
      const f = await attemptedAndOld()
      await pool.query("UPDATE orders SET payment_state='not_required' WHERE id=$1", [f.order])
      const before = await fx.refundRow(f.order)
      const refund = vi.spyOn(f.adapter, 'refund')
      await expect(call(f.note, 'release', body, { adapter: f.adapter })).rejects.toMatchObject({ status: 409, code: 'refund_attempt_unavailable' })
      await expectUntouched(f, before, refund)
    })
  })

  it('offers no operator override: an extra field is refused as invalid', async () => {
    const f = await attemptedAndOld()
    const before = await fx.refundRow(f.order)
    const refund = vi.spyOn(f.adapter, 'refund')
    await expect(call(f.note, 'release', { ...body, force: true }, { adapter: f.adapter })).rejects.toMatchObject({ status: 422, code: 'invalid' })
    await expectUntouched(f, before, refund)
  })

  it('serves only an attempted row', async () => {
    const returned = await fx.returnedInConflict()
    await expect(call(returned.note, 'release', body, { adapter: returned.adapter })).rejects.toMatchObject({ status: 409, code: 'refund_not_stuck' })
    const running = await fx.simulatorPaid()
    const note = await fx.askRefund(running.invoice)
    await expect(call(note.id, 'release', body, { adapter: running.adapter })).rejects.toMatchObject({ status: 409, code: 'refund_not_stuck' })
  })

  it('needs the billing grant, a fresh step-up and a reason of 3 to 1000 characters', async () => {
    const f = await attemptedAndOld()
    const before = await fx.refundRow(f.order)
    const refund = vi.spyOn(f.adapter, 'refund')
    await expect(call(f.note, 'release', body, { adapter: f.adapter, caps: ['vendor.read'] })).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    await expect(call(f.note, 'release', body, { adapter: f.adapter, stepUp: false })).rejects.toMatchObject({ status: 403, code: 'step_up_required' })
    for (const reason of ['', 'ab', 'x'.repeat(1001)]) await expect(call(f.note, 'release', { reason }, { adapter: f.adapter })).rejects.toMatchObject({ status: 422, code: 'invalid' })
    await expect(call(f.note, 'release', undefined, { adapter: f.adapter })).rejects.toMatchObject({ status: 422 })
    await expectUntouched(f, before, refund)
  })

  describe('races', () => {
    it('answers refund_in_progress while the worker holds the order\'s refund lock, and changes nothing', async () => {
      const f = await attemptedAndOld()
      const before = await fx.refundRow(f.order)
      const refund = vi.spyOn(f.adapter, 'refund')
      const held = await holdOrderLock(pool, f.order)
      try { await expect(call(f.note, 'release', body, { adapter: f.adapter })).rejects.toMatchObject({ status: 409, code: 'refund_in_progress' }) }
      finally { await held.release() }
      await expectUntouched(f, before, refund)
    })

    it('lets exactly one of two operator releases act: the other waits out as refund_in_progress, and a later one finds nothing to release', async () => {
      const f = await attemptedAndOld()
      const real = f.adapter.lookupAttempt.bind(f.adapter)
      let reads = 0
      let free!: () => void
      const gate = new Promise<void>(resolve => { free = resolve })
      vi.spyOn(f.adapter, 'lookupAttempt').mockImplementation(async ref => { if (reads++ === 0) await gate; return real(ref) })
      const first = call(f.note, 'release', body, { adapter: f.adapter })
      await vi.waitFor(() => expect(reads).toBe(1))
      await expect(call(f.note, 'release', body, { adapter: f.adapter, actor: 8 })).rejects.toMatchObject({ status: 409, code: 'refund_in_progress' })
      free()
      await expect(first).resolves.toMatchObject({ status: 200 })
      await expect(call(f.note, 'release', body, { adapter: f.adapter, actor: 8 })).rejects.toMatchObject({ status: 409, code: 'refund_not_stuck' })
      expect(await audits(f.note)).toHaveLength(1)
    })

    it('does not release a hold the worker re-marked while the operator was reading', async () => {
      const f = await attemptedAndOld()
      const real = f.adapter.lookupAttempt.bind(f.adapter)
      vi.spyOn(f.adapter, 'lookupAttempt').mockImplementation(async ref => {
        const event = await real(ref)
        await pool.query("UPDATE commercial_outbox SET payload=(payload - 'provider_refund' - 'attempted_at') || '{\"provider_refund\":\"returned\",\"provider_payment_id\":\"sim_pay_x\"}'::jsonb WHERE aggregate_id=$1", [f.order])
        return event
      })
      await expect(call(f.note, 'release', body, { adapter: f.adapter })).rejects.toMatchObject({ status: 409, code: 'refund_not_stuck' })
      expect((await fx.refundRow(f.order)).payload.provider_refund).toBe('returned')
      expect(await audits(f.note)).toHaveLength(0)
    })
  })

  it('answers a finished refund with the current view and writes nothing', async () => {
    const f = await attemptedAndOld()
    await fx.refundWholePayment(f)
    await fx.runAgain(f)
    expect(await fx.refundRow(f.order)).toMatchObject({ status: 'done' })
    await expect(call(f.note, 'release', body, { adapter: f.adapter })).resolves.toMatchObject({ status: 200, data: { provider: null } })
    expect(await audits(f.note)).toHaveLength(0)
  })
})
