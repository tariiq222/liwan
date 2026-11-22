import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { routesB } from '../commercial/routes-b.js'
import { recheckAutomaticRefund } from '../commercial/stuck-refund.js'
import { PaymentError } from '../commercial/payment-adapter.js'
import { processRefundOutbox } from '../commercial/settlements.js'
import { setup, url } from './commercial-helpers.js'
import { operator, stuckRefundFixtures } from './stuck-refund-fixtures.js'
import { callStuckAction, holdOrderLock } from './stuck-refund-calls.js'

const suite = url ? describe : describe.skip
suite('check again now on a stuck automatic refund on PostgreSQL', () => {
  const pool = new Pool({ connectionString: url, max: 8 })
  const fx = stuckRefundFixtures(pool)
  const call = callStuckAction(pool)
  beforeAll(async () => { await setup(pool) })
  beforeEach(async () => { await pool.query('TRUNCATE customers CASCADE'); await pool.query('TRUNCATE commercial_outbox') })
  afterEach(() => { vi.restoreAllMocks() })
  afterAll(async () => { await pool.end() })
  const audits = async (note: string) => (await pool.query("SELECT actor,reason,metadata FROM audit_events WHERE subject=$1 AND action='payment.refund_rechecked'", [note])).rows
  const postpone = (order: string) => pool.query("UPDATE commercial_outbox SET next_attempt_at=now() + interval '55 minutes' WHERE aggregate_id=$1", [order])

  const shownAttempted = { status: 'succeeded', refunded: null }
  const agePast = (order: string, minutes: number) => pool.query("UPDATE commercial_outbox SET payload=payload || jsonb_build_object('attempted_at',$2::text) WHERE aggregate_id=$1",
    [order, new Date(Date.now() - minutes * 60_000).toISOString()])

  it.each([['an attempted row at least 60 minutes old', async () => { const f = await fx.attempted(); await agePast(f.order, 61); return f }, 'attempted', shownAttempted],
    ['a returned row', async () => fx.returnedInConflict(), 'returned', { status: 'refunded', refunded: { currency: 'SAR', exponent: 2, minor: 11500 } }]] as const)('reads %s, makes it due and changes nothing else', async (_name, arrange, mark, shown) => {
    const f = await arrange()
    await postpone(f.order)
    const before = await fx.refundRow(f.order)
    const refund = vi.spyOn(f.adapter, 'refund')
    const result = await call(f.note, 'check', undefined, { adapter: f.adapter })
    expect(result).toMatchObject({ status: 200, data: { provider: { ...shown, payment_id: f.paymentId } } })
    expect(result!.data).toMatchObject({ invoice: { id: f.invoice } })
    const after = await fx.refundRow(f.order)
    expect(after.payload).toEqual(before.payload)
    expect({ status: after.status, attempts: after.attempts }).toEqual({ status: 'pending', attempts: before.attempts })
    expect(after.next_attempt_at.getTime()).toBeLessThanOrEqual(Date.now())
    expect(before.next_attempt_at.getTime()).toBeGreaterThan(Date.now())
    expect(refund).not.toHaveBeenCalled()
    expect(await audits(f.note)).toEqual([expect.objectContaining({ actor: 'vendor-test:7', metadata: expect.objectContaining({ payment_id: f.paymentId, provider_status: shown.status, provider_refund: mark }) })])
  })

  it('shows a young attempted row\'s payment but leaves the row waiting, so no number of checks makes the worker repeat the refund call', async () => {
    const f = await fx.attempted()
    await postpone(f.order)
    const before = await fx.refundRow(f.order)
    const refund = vi.spyOn(f.adapter, 'refund')
    for (let i = 0; i < 3; i++) {
      await expect(call(f.note, 'check', undefined, { adapter: f.adapter })).resolves.toMatchObject({ status: 200, data: { provider: { ...shownAttempted, payment_id: f.paymentId } } })
      expect(await processRefundOutbox(pool, f.adapter)).toBeDefined()
    }
    expect(await fx.refundRow(f.order)).toEqual(before)
    expect(refund).not.toHaveBeenCalled()
    expect(await audits(f.note)).toHaveLength(3)
  })

  it('shows what the provider returned when the money is already back, and lets the worker record it with no second call', async () => {
    const f = await fx.attempted()
    await agePast(f.order, 61)
    await fx.refundWholePayment(f)
    const result = await call(f.note, 'check', undefined, { adapter: f.adapter })
    expect(result!.data).toMatchObject({ provider: { status: 'refunded', payment_id: f.paymentId, refunded: { minor: f.total, currency: 'SAR', exponent: 2 } } })
    const refund = vi.spyOn(f.adapter, 'refund')
    await processRefundOutbox(pool, f.adapter)
    expect(refund).not.toHaveBeenCalled()
    expect((await fx.notes(f.invoice))[0]).toMatchObject({ status: 'refunded', refunded_by: 'system' })
  })

  it('needs the billing grant, but no step-up and no reason', async () => {
    const f = await fx.attempted()
    await expect(call(f.note, 'check', undefined, { adapter: f.adapter, caps: ['vendor.read'] })).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    await expect(call(f.note, 'check', undefined, { adapter: f.adapter, stepUp: false })).resolves.toMatchObject({ status: 200 })
  })

  it('answers refund_in_progress while the worker holds the order\'s refund lock, and changes nothing', async () => {
    const f = await fx.attempted()
    await postpone(f.order)
    const before = await fx.refundRow(f.order)
    const held = await holdOrderLock(pool, f.order)
    try { await expect(call(f.note, 'check', undefined, { adapter: f.adapter })).rejects.toMatchObject({ status: 409, code: 'refund_in_progress' }) }
    finally { await held.release() }
    expect(await fx.refundRow(f.order)).toEqual(before)
    expect(await audits(f.note)).toHaveLength(0)
  })

  it('answers refund_in_progress while the worker is in the middle of its provider call', async () => {
    const f = await fx.simulatorPaid()
    const note = await fx.askRefund(f.invoice)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let started!: () => void
    const inCall = new Promise<void>(resolve => { started = resolve })
    const refund = vi.spyOn(f.adapter, 'refund').mockImplementation(async () => { started(); await gate; throw new PaymentError('provider_error', 'late') })
    const worker = processRefundOutbox(pool, f.adapter)
    await inCall
    await expect(call(note.id, 'check', undefined, { adapter: f.adapter })).rejects.toMatchObject({ status: 409, code: 'refund_in_progress' })
    release()
    await worker
    expect(refund).toHaveBeenCalledTimes(1)
  })

  it('refuses with provider_refund_unavailable when no payment adapter is configured, and changes nothing', async () => {
    const f = await fx.attempted()
    await postpone(f.order)
    const before = await fx.refundRow(f.order)
    await expect(call(f.note, 'check', undefined, {})).rejects.toMatchObject({ status: 409, code: 'provider_refund_unavailable' })
    expect(await fx.refundRow(f.order)).toEqual(before)
  })

  it('refuses with provider_status_unverified when the payment cannot be read or is not the attempt\'s, and changes nothing', async () => {
    const f = await fx.attempted()
    await postpone(f.order)
    const before = await fx.refundRow(f.order)
    vi.spyOn(f.adapter, 'lookupAttempt').mockRejectedValueOnce(new PaymentError('timeout', 'lookup'))
    await expect(call(f.note, 'check', undefined, { adapter: f.adapter })).rejects.toMatchObject({ status: 409, code: 'provider_status_unverified' })
    await pool.query("UPDATE payment_attempts SET amount_minor=amount_minor+100 WHERE order_id=$1", [f.order])
    await expect(call(f.note, 'check', undefined, { adapter: f.adapter })).rejects.toMatchObject({ status: 409, code: 'provider_status_unverified' })
    expect(await fx.refundRow(f.order)).toEqual(before)
  })

  it('refuses a note whose refund is not stuck, returns the view of a finished one, and 404s a missing note', async () => {
    const f = await fx.simulatorPaid()
    const note = await fx.askRefund(f.invoice)
    await expect(call(note.id, 'check', undefined, { adapter: f.adapter })).rejects.toMatchObject({ status: 409, code: 'refund_not_stuck' })
    await processRefundOutbox(pool, f.adapter)
    const done = await call(note.id, 'check', undefined, { adapter: f.adapter })
    expect(done).toMatchObject({ status: 200, data: { provider: null, invoice: { id: f.invoice } } })
    expect(await audits(note.id)).toHaveLength(0)
    await expect(call('00000000-0000-4000-8000-000000000000', 'check', undefined, { adapter: f.adapter })).rejects.toMatchObject({ status: 404 })
    await expect(call('not-a-uuid', 'check', undefined, { adapter: f.adapter })).rejects.toMatchObject({ status: 404 })
  })

  it('is bound to POST', async () => {
    const f = await fx.attempted()
    const pathname = `/v1/commercial/invoice-adjustments/${f.note}/automatic-refund/check`
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const answer = await routesB(pool, { method, pathname, raw: '', issuer: 'vendor-test', actor: 7, capabilities: ['vendor.read', 'vendor.billing.manage'] as any, stepUpFresh: true },
        new URL(pathname, 'https://liwan.test'), { adapter: f.adapter, returnOrigin: null }).catch(error => error)
      expect(answer).toBeNull()
    }
  })

  it('works through the exported function with the operator as actor', async () => {
    const f = await fx.attempted()
    const result = await recheckAutomaticRefund(pool, { adjustment_id: f.note, actor: operator, adapter: f.adapter })
    expect(result.provider).toMatchObject({ payment_id: f.paymentId })
  })
})
