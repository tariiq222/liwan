import http from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { ApiErrorSchema } from '../../../../../packages/contracts/src/common/error'

afterEach(() => vi.resetModules())

async function fixture() {
  vi.resetModules()
  const { requireApiSession } = await import('../apiSessionAdmission')
  const { withUpstreamSlot } = await import('../tenantTransport')
  const held: Array<() => void> = []
  const waiting: Array<() => void> = []
  const probes: string[] = []
  let active = 0
  let entered = 0
  let maxActive = 0
  let hold = false
  let unavailable = false
  const upstream = http.createServer((req, res) => {
    req.resume()
    // Model the deployed two HTTP worker processes: a request retains one worker
    // until its response finishes, and all other requests wait for a free worker.
    const serve = () => {
      active++
      maxActive = Math.max(maxActive, active)
      let finished = false
      const release = () => {
        if (finished) return
        finished = true
        active--
        waiting.shift()?.()
      }
      res.once('finish', release)
      res.once('close', release)
      if (req.url !== '/api/v1/me') { res.end('application'); return }
      probes.push(req.headers.cookie ?? '')
      const respond = () => {
        if (unavailable) { res.statusCode = 503; res.end('{}'); return }
        if (req.headers.cookie?.startsWith('session_id=suspended')) { res.statusCode = 403; res.end(JSON.stringify({ code: 'tenant_suspended', message: 'this tenant is suspended' })); return }
        if (!req.headers.cookie?.startsWith('session_id=verified')) { res.statusCode = 403; res.end('{}'); return }
        res.end(JSON.stringify({ id: 7, company: { id: 1 } }))
      }
      if (hold) held.push(respond); else respond()
    }
    if (active < 2) serve(); else waiting.push(serve)
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const upstreamUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
  const h3 = createApp()
  h3.use(defineEventHandler(async event => {
    // requireApiSession registers its lane waiter synchronously, so once a request has
    // entered, its probe is either running or already queued.
    entered++
    await requireApiSession(event, upstreamUrl, {})
    const response = await withUpstreamSlot(signal => fetch(upstreamUrl + '/api/v1/tasks', { signal }), event)
    return response.text()
  }))
  const app = http.createServer(toNodeListener(h3))
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(app.address() as { port: number }).port}`
  return {
    probes, held,
    get entered() { return entered }, get active() { return active }, get maxActive() { return maxActive }, get waiting() { return waiting.length },
    hold() { hold = true }, outage() { unavailable = true }, recover() { unavailable = false },
    release() { hold = false; for (const respond of held.splice(0)) respond() },
    call(session?: string) { return fetch(url, { headers: session ? { cookie: `session_id=${session}` } : {} }) },
    async close() {
      hold = false
      for (const release of held) release()
      for (const server of [app, upstream]) {
        server.closeAllConnections()
        await new Promise<void>(resolve => server.close(() => resolve()))
      }
    },
  }
}

// Omitting message from admission data breaks the same strict schema useApi consumes.
it.each([
  ['missing', 403, 'session_required', 'A valid session is required.'],
  ['forged', 403, 'session_required', 'A valid session is required.'],
  // Odoo ends a suspended tenant's session; the reason must reach the browser.
  ['suspended', 403, 'tenant_suspended', 'This tenant is suspended.'],
  ['outage', 503, 'session_validation_unavailable', 'Session validation is temporarily unavailable.'],
] as const)('returns the complete strict API envelope for %s admission', async (kind, status, code, message) => {
  const wire = await fixture()
  try {
    if (kind === 'outage') wire.outage()
    const response = await wire.call(kind === 'missing' ? undefined : kind)
    expect(response.status).toBe(status)
    const body = await response.json()
    expect(ApiErrorSchema.parse(body.data)).toEqual({ code, message })
  } finally { await wire.close() }
})

// Allowing two forged probes consumes both fixture workers and stalls warm work.
it('reserves one of two HTTP workers for verified work while queueing an excess cold probe', async () => {
  const wire = await fixture()
  const pending: Array<Promise<Response>> = []
  try {
    expect(await (await wire.call('verified')).text()).toBe('application')
    wire.hold()
    pending.push(wire.call('forged-a'))
    await vi.waitFor(() => expect(wire.held).toHaveLength(1))
    let excessStatus: number | undefined
    let warmBody: string | undefined
    const excess = wire.call('forged-b').then(response => { excessStatus = response.status; return response })
    pending.push(excess)
    const warm = wire.call('verified').then(response => response.text()).then(body => { warmBody = body })
    await vi.waitFor(() => expect(warmBody).toBe('application'), { timeout: 500 })
    // The excess cold probe now waits in the lane queue instead of being rejected at once.
    expect(excessStatus).toBeUndefined()
    await warm
    expect(wire.probes).toEqual(['session_id=verified', 'session_id=forged-a'])
    expect(wire.active).toBe(1)
    expect(wire.maxActive).toBe(2)
    expect(wire.waiting).toBe(0)
    wire.held[0]!()
    expect((await pending[0]!).status).toBe(403)
    // Releasing the lane hands it to the queued probe.
    await vi.waitFor(() => expect(wire.held).toHaveLength(2))
    wire.held[1]!()
    expect((await excess).status).toBe(403)
    wire.held.length = 0
    const recovery = wire.call('forged-recovery')
    pending.push(recovery)
    await vi.waitFor(() => expect(wire.held).toHaveLength(1))
    wire.held[0]!()
    expect((await recovery).status).toBe(403)
  } finally { await wire.close(); await Promise.allSettled(pending) }
})

const busyBody = { code: 'session_admission_busy', message: 'Session validation is busy. Try again shortly.' }

it('lets two distinct valid sessions probe concurrently by queueing the second', async () => {
  const wire = await fixture()
  try {
    wire.hold()
    const first = wire.call('verified-a')
    await vi.waitFor(() => expect(wire.held).toHaveLength(1))
    const second = wire.call('verified-b')
    wire.held[0]!()
    expect(await (await first).text()).toBe('application')
    await vi.waitFor(() => expect(wire.held).toHaveLength(2))
    wire.held[1]!()
    const response = await second
    expect([response.status, await response.text()]).toEqual([200, 'application'])
    expect(wire.probes).toEqual(['session_id=verified-a', 'session_id=verified-b'])
  } finally { await wire.close() }
})

it('rejects only the waiter beyond the bounded queue and leaks no lane state', async () => {
  const wire = await fixture()
  const queued: Array<Promise<Response>> = []
  try {
    wire.hold()
    queued.push(wire.call('forged-0'))
    await vi.waitFor(() => expect(wire.held).toHaveLength(1))
    for (let index = 1; index <= 32; index++) queued.push(wire.call(`forged-${index}`))
    await vi.waitFor(() => expect(wire.entered).toBe(33))
    const overflow = await wire.call('forged-overflow')
    expect(overflow.status).toBe(429)
    expect(ApiErrorSchema.parse((await overflow.json()).data)).toEqual(busyBody)
    wire.release()
    expect((await Promise.all(queued)).map(response => response.status)).toEqual(Array(33).fill(403))
    expect(wire.probes).toHaveLength(33)
    // The lane is free again: a new identity check is probed at once.
    expect(await (await wire.call('verified-after')).text()).toBe('application')
  } finally { await wire.close(); await Promise.allSettled(queued) }
})

it('answers 429 to a waiter whose wait expires and removes it from the queue', async () => {
  const wire = await fixture()
  const pending: Array<Promise<Response>> = []
  try {
    wire.hold()
    pending.push(wire.call('forged-a'))
    await vi.waitFor(() => expect(wire.held).toHaveLength(1))
    pending.push(wire.call('forged-b'))
    await vi.waitFor(() => expect(wire.entered).toBe(2))
    const expired = wire.call('forged-c')
    pending.push(expired)
    // The first probe hits its own 2s deadline, which was armed before forged-b queued, and
    // hands the lane to forged-b; forged-c then waits its full 2s behind that probe and is rejected.
    const response = await expired
    expect(response.status).toBe(429)
    expect(ApiErrorSchema.parse((await response.json()).data)).toEqual(busyBody)
    expect((await pending[0]!).status).toBe(503)
    wire.release()
    expect((await pending[1]!).status).toBe(403)
    expect(wire.probes).toEqual(['session_id=forged-a', 'session_id=forged-b'])
    expect(await (await wire.call('verified-after')).text()).toBe('application')
  } finally { await wire.close(); await Promise.allSettled(pending) }
}, 10_000)

it('serves a definitively rejected session from the negative cache but never caches unavailable', async () => {
  const wire = await fixture()
  try {
    expect((await wire.call('forged-x')).status).toBe(403)
    expect((await wire.call('forged-x')).status).toBe(403)
    expect(wire.probes).toEqual(['session_id=forged-x'])
    wire.outage()
    expect((await wire.call('verified-flaky')).status).toBe(503)
    expect((await wire.call('verified-flaky')).status).toBe(503)
    wire.recover()
    expect(await (await wire.call('verified-flaky')).text()).toBe('application')
    expect(wire.probes.filter(probe => probe === 'session_id=verified-flaky')).toHaveLength(3)
  } finally { await wire.close() }
})

it('validates a real session queued behind a flood of forged sessions', async () => {
  const wire = await fixture()
  const flood: Array<Promise<Response>> = []
  try {
    wire.hold()
    flood.push(wire.call('forged-0'))
    await vi.waitFor(() => expect(wire.held).toHaveLength(1))
    for (let index = 1; index <= 8; index++) flood.push(wire.call(`forged-${index}`))
    const valid = wire.call('verified-real')
    wire.release()
    const response = await valid
    expect([response.status, await response.text()]).toEqual([200, 'application'])
    expect((await Promise.all(flood)).map(item => item.status)).toEqual(Array(9).fill(403))
  } finally { await wire.close(); await Promise.allSettled(flood) }
})

const CONSUMERS_PER_PROBE = 16

// The first request owns the probe; excess consumers of one key are refused before they can
// retain a socket or buffered upload for the probe window, and a settled probe leaves no count.
it.each([
  ['rejects', 403, false],
  ['is unavailable', 503, true],
] as const)('caps requests attached to one probe and frees the count when the probe %s', async (_outcome, status, outage) => {
  const wire = await fixture()
  const attached: Array<Promise<Response>> = []
  try {
    wire.hold()
    if (outage) wire.outage()
    attached.push(wire.call('forged-same'))
    await vi.waitFor(() => expect(wire.held).toHaveLength(1))
    for (let index = 1; index < CONSUMERS_PER_PROBE; index++) attached.push(wire.call('forged-same'))
    await vi.waitFor(() => expect(wire.entered).toBe(CONSUMERS_PER_PROBE))
    for (let extra = 0; extra < 4; extra++) {
      const response = await wire.call('forged-same')
      expect(response.status).toBe(429)
      expect(ApiErrorSchema.parse((await response.json()).data)).toEqual(busyBody)
    }
    expect(wire.probes).toEqual(['session_id=forged-same'])
    wire.release()
    expect((await Promise.all(attached)).map(response => response.status)).toEqual(Array(CONSUMERS_PER_PROBE).fill(status))
    if (!outage) return
    // Unavailable is never cached, so a full burst attaches again: the count returned to zero.
    wire.hold()
    const again = Array.from({ length: CONSUMERS_PER_PROBE }, () => wire.call('forged-same'))
    attached.push(...again)
    await vi.waitFor(() => expect(wire.entered).toBe(CONSUMERS_PER_PROBE * 2 + 4))
    wire.release()
    expect((await Promise.all(again)).map(response => response.status)).toEqual(Array(CONSUMERS_PER_PROBE).fill(503))
    expect(wire.probes).toEqual(['session_id=forged-same', 'session_id=forged-same'])
  } finally { await wire.close(); await Promise.allSettled(attached) }
})
