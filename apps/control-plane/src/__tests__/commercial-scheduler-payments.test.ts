import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCommercialScheduler } from '../commercial/scheduler.js'
import type { Config } from '../config.js'
import type { Pool } from 'pg'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'

// External jobs are isolated: this test owns scheduler cadence and failure reporting,
// while the live PostgreSQL reconciliation suite exercises selection and settlement.
// Kept apart from commercial-scheduler.test.ts, whose usage tests need the real modules.
const jobs = vi.hoisted(() => ({ reconcile: vi.fn(async () => [] as { id: string; outcome: string }[]) }))
vi.mock('../commercial/payments.js', () => ({ reconcileUnknownAttempts: jobs.reconcile }))
vi.mock('../commercial/fulfillment.js', () => ({ processFulfillmentOutbox: async () => 0 }))
vi.mock('../commercial/outbox.js', () => ({ claimOutbox: async () => [], completeOutbox: async () => {}, failOutbox: async () => {} }))
vi.mock('../shared/subscription-reconcile.js', () => ({ recoverInterrupted: async () => {} }))
vi.mock('../commercial/renewals.js', () => ({ generateRenewals: async () => {}, applyDunning: async () => {} }))
vi.mock('../commercial/settlements.js', () => ({ processRefundOutbox: async () => 0 }))

afterEach(() => { vi.restoreAllMocks(); jobs.reconcile.mockReset() })
describe('commercial scheduler payment recovery', () => {
  it('reports a partial reconciliation failure instead of a healthy job, and continues next ticks', async () => {
    jobs.reconcile.mockResolvedValueOnce([{ id: 'one', outcome: 'accepted' }, { id: 'two', outcome: 'provider_unavailable' }]).mockResolvedValueOnce([])
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const logs: string[] = []
    const scheduler = createCommercialScheduler({ pool: {} as Pool, config: {} as Config,
      env: { WEBVUE_COMMERCIAL_RECONCILE_EVERY: '2' }, clock: () => 0, paymentAdapter: new SimulatorAdapter(),
      log: (message, error) => logs.push(`${message}: ${error instanceof Error ? error.message : error}`) })
    await scheduler.tick()
    expect(JSON.parse(debug.mock.calls.at(-1)![0]).jobs['reconcile-payments']).toBeUndefined()
    await scheduler.tick()
    expect(JSON.parse(debug.mock.calls.at(-1)![0]).jobs['reconcile-payments']).toEqual({ runs: 1, failures: 1 })
    expect(logs.join(' ')).toContain('reconcile-payments failed')
    await scheduler.tick(); await scheduler.tick()
    expect(JSON.parse(debug.mock.calls.at(-1)![0]).jobs['reconcile-payments']).toEqual({ runs: 1, failures: 0 })
  })
})
