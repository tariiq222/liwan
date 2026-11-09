import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { scratchUrl, seedOrder, setupScratch } from './shared-subscription-reconfigure.test.js'
import { processFulfillmentOutbox } from '../commercial/fulfillment.js'
import { expireSharedLeases } from '../shared/job-worker.js'
import { runSubscriptionReconfigure } from '../shared/subscription-reconfigure.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

describe.skipIf(!scratchUrl)('subscription refusal fencing on PostgreSQL', () => {
  const pool = new Pool({ connectionString: scratchUrl })
  beforeAll(() => setupScratch(pool))
  afterAll(() => pool.end())

  it('a superseded worker cannot refuse the order under its replacement', async () => {
    const { order, receipt } = await seedOrder(pool)
    await processFulfillmentOutbox(pool)
    const { id } = (await pool.query('SELECT job_id AS id FROM fulfillment_effects WHERE order_id=$1', [order])).rows[0]
    const formerStarted = deferred<void>()
    const formerFinish = deferred<never>()
    const replacementStarted = deferred<void>()
    const replacementFinish = deferred<void>()
    const former = runSubscriptionReconfigure(pool, id, async () => {
      formerStarted.resolve()
      return formerFinish.promise
    }).catch((error: Error) => error.message)
    await formerStarted.promise
    await pool.query("UPDATE shared_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [id])
    expect(await expireSharedLeases(pool)).toBeGreaterThan(0)
    const replacement = runSubscriptionReconfigure(pool, id, async () => {
      replacementStarted.resolve()
      await replacementFinish.promise
      return receipt
    }, true)
    try {
      await replacementStarted.promise
      formerFinish.reject(new Error('tenant_binding_mismatch'))
      const staleError = await former
      const state = (await pool.query('SELECT fulfillment_state FROM orders WHERE id=$1', [order])).rows[0].fulfillment_state
      expect({ staleError, state }).toEqual({ staleError: 'shared_lease_lost', state: 'applying' })
    } finally {
      formerFinish.reject(new Error('test_finished'))
      replacementFinish.resolve()
      await Promise.allSettled([former, replacement])
    }
    expect(await replacement).toMatchObject({ state: 'verified' })
  }, 20_000)
})
