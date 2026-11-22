import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { setup, url } from './commercial-helpers.js'
import { stuckRefundFixtures } from './stuck-refund-fixtures.js'
import { callStuckAction } from './stuck-refund-calls.js'

// Money leaves only through the refund worker (`processRefundOutbox`). The three operator actions read the provider and write the row; if one of
// them ever reaches the adapter's refund call, a double refund becomes possible, so this suite fails the moment it does.
describe('the stuck refund actions never move money', () => {
  it('has no call to a refund endpoint, and none to the worker\'s refund step, in the module that holds the actions', () => {
    const source = readFileSync(join(import.meta.dirname, '../commercial/stuck-refund.ts'), 'utf8')
    expect(source).not.toMatch(/\.refund\(/)
    expect(source).not.toMatch(/returnPaymentAtProvider|refundThroughProvider|processRefundOutbox/)
  })
})

const suite = url ? describe : describe.skip
suite('the stuck refund actions never reach the adapter\'s refund call on PostgreSQL', () => {
  const pool = new Pool({ connectionString: url, max: 8 })
  const fx = stuckRefundFixtures(pool)
  const call = callStuckAction(pool)
  beforeAll(async () => { await setup(pool) })
  beforeEach(async () => { await pool.query('TRUNCATE customers CASCADE'); await pool.query('TRUNCATE commercial_outbox') })
  afterEach(() => { vi.restoreAllMocks() })
  afterAll(async () => { await pool.end() })
  const reason = 'Operator decision on the provider state'
  const aged = (order: string) => pool.query("UPDATE commercial_outbox SET payload=jsonb_set(payload,'{attempted_at}',to_jsonb($2::text)) WHERE aggregate_id=$1", [order, new Date(Date.now() - 2 * 3_600_000).toISOString()])
  /** An adapter that fails the test the moment its refund call is reached. */
  const forbidRefund = (adapter: { refund: unknown }) => vi.spyOn(adapter as { refund: (...args: unknown[]) => unknown }, 'refund').mockImplementation(() => { throw Error('MONEY MOVED: an operator action called the provider refund') })

  it('check, on an attempted and on a returned row', async () => {
    for (const f of [await fx.attempted(), await fx.returnedInConflict()]) {
      const refund = forbidRefund(f.adapter)
      await call(f.note, 'check', undefined, { adapter: f.adapter })
      expect(refund).not.toHaveBeenCalled()
    }
  })

  it('release, whether the provider shows the payment refunded or untouched, and whatever it refuses', async () => {
    const untouched = await fx.attempted(), returned = await fx.attempted(), partial = await fx.attempted()
    await aged(untouched.order); await aged(returned.order); await aged(partial.order)
    await fx.refundWholePayment(returned)
    await partial.adapter.refund(partial.paymentId, { minor: 5000, currency: 'SAR', exponent: 2 })
    for (const f of [untouched, returned, partial]) {
      const refund = forbidRefund(f.adapter)
      await call(f.note, 'release', { reason }, { adapter: f.adapter }).catch(() => undefined)
      expect(refund).not.toHaveBeenCalled()
    }
  })

  it('record, with both resolutions', async () => {
    const recorded = await fx.returnedInConflict(), duplicate = await fx.returnedInConflict({ sameInvoice: true })
    for (const [f, resolution] of [[recorded, 'record'], [duplicate, 'already_recorded']] as const) {
      const refund = forbidRefund(f.adapter)
      await call(f.note, 'record', { reason, resolution }, { adapter: f.adapter })
      expect(refund).not.toHaveBeenCalled()
    }
  })
})
