import { EventEmitter } from 'node:events'
import { afterEach, expect, it } from 'vitest'
import type { H3Event } from 'h3'
import { POOL_LIMITS } from '../bufferAdmission.mjs'
import { withTenantBody, withTenantResponse, type AdmissionScope } from '../tenantTransport'

const gates: Array<() => void> = []
const holders: Array<Promise<unknown>> = []
// Queued holders only enter (and register a gate) once an earlier one leaves, so drain until all settle.
afterEach(async () => {
  let remaining = holders.length
  holders.forEach(done => done.then(() => { remaining-- }, () => { remaining-- }))
  while (remaining > 0) { for (const open of gates.splice(0)) open(); await new Promise(resolve => setTimeout(resolve, 0)) }
  holders.length = 0
})

const event = () => {
  const req = Object.assign(new EventEmitter(), { method: 'POST', aborted: false })
  const res = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false, writableFinished: true, closed: false, headersSent: false, setHeader() {} })
  return { node: { req, res } } as unknown as H3Event
}
/** Take a credit and keep it until the test opens its gate. */
function hold(scope: AdmissionScope, kind: 'body' | 'response' = 'body') {
  let entered!: () => void
  const inside = new Promise<void>(resolve => { entered = resolve })
  const run = () => new Promise<void>(resolve => { gates.push(resolve); entered() })
  const done = kind === 'body' ? withTenantBody(event(), scope, run) : withTenantResponse(event(), scope, run)
  holders.push(done)
  return { inside, done }
}
const settledWithin = (promise: Promise<unknown>) => Promise.race([promise.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 200))])
/** Fill a pool to its limit (and its queue) so the next caller of it is refused. */
async function saturate(scope: AdmissionScope) {
  const { active, queued } = POOL_LIMITS[scope]
  const saturated = Array.from({ length: active + queued }, () => hold(scope))
  await Promise.all(saturated.slice(0, active).map(holder => holder.inside))
  // Every credit and queue place is taken: further work of this scope is refused, not queued.
  await expect(withTenantBody(event(), scope, async () => {})).rejects.toMatchObject({ statusCode: 502 })
  return saturated
}

it('lets authenticated bodies and responses proceed while the public pool is saturated', async () => {
  await saturate('public')
  for (const kind of ['body', 'response'] as const) {
    const authenticated = hold('session', kind)
    expect(await settledWithin(authenticated.inside)).toBe(true)
  }
})

it('lets public traffic proceed while the authenticated pool is saturated', async () => {
  await saturate('session')
  for (const scope of ['public', 'booking'] as const) {
    for (const kind of ['body', 'response'] as const) {
      expect(await settledWithin(hold(scope, kind).inside)).toBe(true)
    }
  }
})

it('lets sign-in proceed while the booking pool is saturated, and the reverse', async () => {
  // A full booking pool (two visitors on a booking page) never queues a sign-in call.
  await saturate('booking')
  for (const kind of ['body', 'response'] as const) {
    expect(await settledWithin(hold('public', kind).inside)).toBe(true)
  }
})

it('lets session and public traffic proceed while the heavy pool is saturated', async () => {
  await saturate('heavy')
  for (const scope of ['session', 'public'] as const) {
    for (const kind of ['body', 'response'] as const) {
      expect(await settledWithin(hold(scope, kind).inside)).toBe(true)
    }
  }
})

it('lets heavy traffic proceed while the session pool is saturated', async () => {
  await saturate('session')
  for (const kind of ['body', 'response'] as const) {
    expect(await settledWithin(hold('heavy', kind).inside)).toBe(true)
  }
})
