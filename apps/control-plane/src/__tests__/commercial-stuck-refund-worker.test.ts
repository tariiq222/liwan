import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { PaymentError } from '../commercial/payment-adapter.js'
import { processRefundOutbox } from '../commercial/settlements.js'
import { setup, url } from './commercial-helpers.js'
import { stuckRefundFixtures } from './stuck-refund-fixtures.js'

const suite = url ? describe : describe.skip
suite('the refund worker leaves what a stuck row needs on PostgreSQL', () => {
  const pool = new Pool({ connectionString: url, max: 6 })
  const fx = stuckRefundFixtures(pool)
  beforeAll(async () => { await setup(pool) })
  beforeEach(async () => { await pool.query('TRUNCATE customers CASCADE'); await pool.query('TRUNCATE commercial_outbox') })
  afterEach(() => { vi.restoreAllMocks() })
  afterAll(async () => { await pool.end() })

  it('stores refund_reference_in_use, not the database message, when another note holds the payment id', async () => {
    const f = await fx.returnedInConflict()
    const row = await fx.refundRow(f.order)
    expect(row).toMatchObject({ status: 'pending', attempts: 1, payload: expect.objectContaining({ provider_refund: 'returned', provider_payment_id: f.paymentId, error: 'refund_reference_in_use' }) })
    expect((await fx.notes(f.invoice))[0]).toMatchObject({ status: 'pending' })
  })

  it('writes attempted_at with the attempted mark', async () => {
    const before = Date.now()
    const f = await fx.attempted()
    const { payload } = await fx.refundRow(f.order)
    expect(payload).toMatchObject({ provider_refund: 'attempted' })
    expect(Date.parse(payload.attempted_at)).toBeGreaterThanOrEqual(before - 1000)
    expect(Date.parse(payload.attempted_at)).toBeLessThanOrEqual(Date.now())
  })

  it('refreshes attempted_at when a retry marks again, and drops it once the money is known returned', async () => {
    const f = await fx.attempted()
    await pool.query("UPDATE commercial_outbox SET payload=jsonb_set(payload,'{attempted_at}','\"2026-01-01T00:00:00.000Z\"') WHERE aggregate_id=$1", [f.order])
    const read = f.adapter.lookupAttempt.bind(f.adapter)
    vi.spyOn(f.adapter, 'refund').mockImplementationOnce(async () => { throw new PaymentError('timeout', 'refund') })
    vi.spyOn(f.adapter, 'lookupAttempt').mockImplementationOnce(read).mockRejectedValueOnce(new PaymentError('timeout', 'lookup'))
    await fx.runAgain(f)
    expect(Date.parse((await fx.refundRow(f.order)).payload.attempted_at)).toBeGreaterThan(Date.parse('2026-02-01'))
    vi.restoreAllMocks()
    await fx.refundWholePayment(f)
    await fx.runAgain(f)
    expect(await fx.refundRow(f.order)).toMatchObject({ status: 'done' })
    expect((await fx.refundRow(f.order)).payload.attempted_at).toBeUndefined()
  })

  it('removes the mark and attempted_at together when the provider proves nothing was returned', async () => {
    const f = await fx.simulatorPaid()
    await fx.askRefund(f.invoice)
    vi.spyOn(f.adapter, 'refund').mockRejectedValue(new PaymentError('provider_error', 'http 422'))
    await processRefundOutbox(pool, f.adapter)
    const { payload } = await fx.refundRow(f.order)
    expect(payload.provider_refund).toBeUndefined()
    expect(payload.attempted_at).toBeUndefined()
  })

  it('behaves as before for a row that was never marked: it completes with neither field', async () => {
    const f = await fx.simulatorPaid()
    const note = await fx.askRefund(f.invoice)
    expect(await fx.refundRow(f.order)).toMatchObject({ payload: expect.not.objectContaining({ attempted_at: expect.anything() }) })
    expect(await processRefundOutbox(pool, f.adapter)).toBe(1)
    expect(await fx.refundRow(f.order)).toMatchObject({ status: 'done' })
    expect((await fx.notes(f.invoice))[0]).toMatchObject({ id: note.id, status: 'refunded' })
    expect((await fx.refundRow(f.order)).payload.attempted_at).toBeUndefined()
  })
})
