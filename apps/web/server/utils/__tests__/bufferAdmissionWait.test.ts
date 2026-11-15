import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createBodyAdmission, createResponseAdmission, HEAVY_CREDITS } from '../bufferAdmission.mjs'

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.resetModules() })

const HEAVY_WAIT = 45_000
const ORDINARY_WAIT = 15_000

const client = () => {
  const req = Object.assign(new EventEmitter(), { method: 'POST', aborted: false }) as unknown as IncomingMessage
  const res = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false, headersSent: false, setHeader() {} }) as unknown as ServerResponse
  return { req, res }
}
const outcome = (pending: Promise<unknown>) => pending.then(value => ({ value }), (error: { statusCode?: number }) => ({ refused: error.statusCode }))

// The default wait is what session and public pools (and the guards) rely on.
it('queues a caller for the ordinary 15s by default and refuses it then, without leaking the waiter', async () => {
  const acquire = createBodyAdmission('session')
  const holders = await Promise.all(Array.from({ length: 4 }, () => acquire(client().req, client().res)))
  const waiter = client()
  const queued = outcome(acquire(waiter.req, waiter.res))
  await vi.advanceTimersByTimeAsync(ORDINARY_WAIT - 1)
  expect(waiter.res.listenerCount('close')).toBe(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(await queued).toEqual({ refused: 502 })
  expect(waiter.res.listenerCount('close')).toBe(0)
  expect(waiter.req.listenerCount('aborted')).toBe(0)
  // The refused waiter took no credit: releasing one holder frees exactly one credit.
  holders[0]!()
  const next = await outcome(acquire(client().req, client().res))
  expect(next).toHaveProperty('value')
})

// Heavy credits are held for the whole heavy run, so a heavy waiter must outlast 15s.
it('lets a heavy-pool caller wait its own, longer budget and refuses it exactly then', async () => {
  const acquire = createResponseAdmission('heavy', HEAVY_WAIT)
  const releases: Array<() => void> = []
  const holders = Array.from({ length: HEAVY_CREDITS }, () => acquire(client().req, client().res, () => new Promise<void>(resolve => releases.push(resolve))))
  await vi.advanceTimersByTimeAsync(0)
  const waiter = client()
  const queued = outcome(acquire(waiter.req, waiter.res, async () => 'ran'))
  await vi.advanceTimersByTimeAsync(ORDINARY_WAIT + 1)
  expect(waiter.res.listenerCount('close')).toBeGreaterThan(0)
  await vi.advanceTimersByTimeAsync(HEAVY_WAIT - ORDINARY_WAIT - 1)
  expect(await queued).toEqual({ refused: 502 })
  expect(waiter.res.listenerCount('close')).toBe(0)
  for (const release of releases) release()
  await Promise.all(holders)
  // No credit leaked: the pool admits its full capacity again at once.
  const again = Array.from({ length: HEAVY_CREDITS }, () => acquire(client().req, client().res, async () => 'ran'))
  expect(await Promise.all(again)).toEqual(Array(HEAVY_CREDITS).fill('ran'))
})

it('hands a credit to a heavy waiter that is still inside its budget', async () => {
  const acquire = createBodyAdmission('heavy', HEAVY_WAIT)
  const holders = await Promise.all(Array.from({ length: HEAVY_CREDITS }, () => acquire(client().req, client().res)))
  const queued = outcome(acquire(client().req, client().res))
  await vi.advanceTimersByTimeAsync(ORDINARY_WAIT * 2)
  holders[0]!()
  expect(await queued).toHaveProperty('value')
})

it('sizes HEAVY_CREDITS and the heavy pool from the heavy pool\'s active variable', async () => {
  vi.stubEnv('NUXT_ODOO_POOL_HEAVY_ACTIVE', '3')
  vi.stubEnv('NUXT_ODOO_POOL_HEAVY_QUEUED', '0')
  vi.resetModules()
  const configured = await import('../bufferAdmission.mjs')
  expect(configured.HEAVY_CREDITS).toBe(3)
  expect(configured.POOL_LIMITS.heavy).toEqual({ active: 3, queued: 0 })
  const acquire = configured.createBodyAdmission('heavy', HEAVY_WAIT)
  const holders = await Promise.all(Array.from({ length: 3 }, () => acquire(client().req, client().res)))
  // No queue place was configured, so the fourth caller is refused at once.
  expect(await outcome(acquire(client().req, client().res))).toEqual({ refused: 502 })
  holders[0]!()
  expect(await outcome(acquire(client().req, client().res))).toHaveProperty('value')
})

it('refuses to load with an invalid pool variable instead of falling back to the default', async () => {
  vi.stubEnv('NUXT_ODOO_POOL_HEAVY_ACTIVE', '0')
  vi.resetModules()
  await expect(import('../bufferAdmission.mjs')).rejects.toThrow('NUXT_ODOO_POOL_HEAVY_ACTIVE must be an integer from 1 to 256')
})
