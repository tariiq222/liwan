import { EventEmitter } from 'node:events'
import { afterEach, expect, it } from 'vitest'
import type { H3Event } from 'h3'
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

it('lets authenticated bodies and responses proceed while the public pool is saturated', async () => {
  const publicHolders = Array.from({ length: 2 + 16 }, () => hold('public'))
  await Promise.all(publicHolders.slice(0, 2).map(holder => holder.inside))
  // Public pool is full (2 active, 16 queued): further public work is refused, not queued.
  await expect(withTenantBody(event(), 'public', async () => {})).rejects.toMatchObject({ statusCode: 502 })
  for (const kind of ['body', 'response'] as const) {
    const authenticated = hold('session', kind)
    expect(await settledWithin(authenticated.inside)).toBe(true)
  }
})

it('lets public traffic proceed while the authenticated pool is saturated', async () => {
  const sessionHolders = Array.from({ length: 4 + 64 }, () => hold('session'))
  await Promise.all(sessionHolders.slice(0, 4).map(holder => holder.inside))
  await expect(withTenantBody(event(), 'session', async () => {})).rejects.toMatchObject({ statusCode: 502 })
  for (const kind of ['body', 'response'] as const) {
    const publicRequest = hold('public', kind)
    expect(await settledWithin(publicRequest.inside)).toBe(true)
  }
})
