import http from 'node:http'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.resetModules() })

const HEAVY = { timeoutMs: 40_000 }
const WAIT_TIMEOUT = 15_000

async function load(concurrency: number) {
  vi.stubEnv('NUXT_ODOO_MAX_CONCURRENCY', String(concurrency))
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  return import('../tenantTransport')
}

const client = () => {
  const req = Object.assign(new EventEmitter(), { aborted: false })
  const res = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false })
  return { req, res, event: { node: { req, res } } as unknown as H3Event }
}
const abortClient = (target: ReturnType<typeof client>) => { target.req.aborted = true; target.req.emit('aborted') }

/** A unit of work that records when it starts and ends only when finished or cancelled. */
function job(withUpstreamSlot: Awaited<ReturnType<typeof load>>['withUpstreamSlot'], budget?: typeof HEAVY, target = client()) {
  const state = { started: false, aborted: false, finish: () => {} }
  const outcome = withUpstreamSlot(signal => new Promise<string>((resolve, reject) => {
    state.started = true
    state.finish = () => resolve('done')
    signal.addEventListener('abort', () => { state.aborted = true; reject(new Error('aborted')) }, { once: true })
  }), target.event, budget).then(value => value, (error: { statusCode?: number }) => `rejected:${error.statusCode}`)
  return { state, outcome, target }
}
const settle = () => vi.advanceTimersByTimeAsync(0)

// With no heavy gate, a second heavy job would start beside the first.
it('admits one heavy job at a time, while ordinary work still runs beside it', async () => {
  const { withUpstreamSlot } = await load(32)
  const first = job(withUpstreamSlot, HEAVY)
  const second = job(withUpstreamSlot, HEAVY)
  const ordinary = job(withUpstreamSlot)
  await settle()
  expect([first.state.started, second.state.started, ordinary.state.started]).toEqual([true, false, true])
  first.state.finish(); ordinary.state.finish()
  await settle()
  expect(second.state.started).toBe(true)
  second.state.finish()
  expect(await Promise.all([first.outcome, second.outcome, ordinary.outcome])).toEqual(['done', 'done', 'done'])
})

// Without taking an ordinary slot too, heavy work would bypass the global limit.
it('also takes an ordinary upstream slot, so the global limit applies to heavy work', async () => {
  const { withUpstreamSlot } = await load(1)
  const ordinary = job(withUpstreamSlot)
  const heavy = job(withUpstreamSlot, HEAVY)
  const secondHeavy = job(withUpstreamSlot, HEAVY)
  await settle()
  expect([heavy.state.started, secondHeavy.state.started]).toEqual([false, false])
  ordinary.state.finish()
  await settle()
  expect([heavy.state.started, secondHeavy.state.started]).toEqual([true, false])
  heavy.state.finish()
  await settle()
  secondHeavy.state.finish()
  expect(await Promise.all([ordinary.outcome, heavy.outcome, secondHeavy.outcome])).toEqual(['done', 'done', 'done'])
})

// Ordinary work gets 15s of admitted time; only the heavy budget extends it.
it('applies the heavy deadline to admitted heavy work and 15s to ordinary work', async () => {
  const { withUpstreamSlot } = await load(32)
  const heavy = job(withUpstreamSlot, HEAVY)
  const ordinary = job(withUpstreamSlot)
  await settle()
  await vi.advanceTimersByTimeAsync(15_000)
  expect([ordinary.state.aborted, heavy.state.aborted]).toEqual([true, false])
  expect(await ordinary.outcome).toBe('rejected:undefined')
  await vi.advanceTimersByTimeAsync(HEAVY.timeoutMs - 15_000)
  expect(heavy.state.aborted).toBe(true)
  expect(await heavy.outcome).toBe('rejected:undefined')
})

// Queued heavy work must give up after the ordinary wait even though its admitted deadline is longer.
it('bounds the heavy queue, times waiters out after 15s with a 502 and leaks nothing', async () => {
  const { withUpstreamSlot } = await load(32)
  const running = job(withUpstreamSlot, HEAVY)
  const queued = Array.from({ length: 8 }, () => job(withUpstreamSlot, HEAVY))
  await settle()
  const overflow = job(withUpstreamSlot, HEAVY)
  expect(await overflow.outcome).toBe('rejected:502')
  expect(overflow.state.started).toBe(false)
  await vi.advanceTimersByTimeAsync(WAIT_TIMEOUT)
  expect(await Promise.all(queued.map(item => item.outcome))).toEqual(Array(8).fill('rejected:502'))
  expect(queued.some(item => item.state.started)).toBe(false)
  expect(running.state.aborted).toBe(false)
  running.state.finish()
  expect(await running.outcome).toBe('done')
  // The gate is idle again: a later heavy job is admitted immediately and queued slots are free.
  const later = job(withUpstreamSlot, HEAVY)
  await settle()
  expect(later.state.started).toBe(true)
  const refill = Array.from({ length: 8 }, () => job(withUpstreamSlot, HEAVY))
  await settle()
  expect(refill.some(item => item.state.started)).toBe(false)
  later.state.finish()
  for (const item of refill) { await settle(); item.state.finish() }
  expect(await Promise.all([later.outcome, ...refill.map(item => item.outcome)])).toEqual(Array(9).fill('done'))
})

// A leaked waiter would later receive the gate and run abandoned work; a leaked count would block it forever.
it.each(['aborted', 'running'] as const)('releases the heavy gate and the ordinary slot when a %s heavy request disconnects', async state => {
  const { withUpstreamSlot } = await load(1)
  const first = job(withUpstreamSlot, HEAVY)
  const second = job(withUpstreamSlot, HEAVY)
  const third = job(withUpstreamSlot, HEAVY)
  await settle()
  if (state === 'running') {
    abortClient(first.target)
    await settle()
    expect(first.state.aborted).toBe(true)
    expect(await first.outcome).toBe('rejected:undefined')
    expect(second.state.started).toBe(true)
    second.state.finish()
    await settle()
    expect(third.state.started).toBe(true)
    third.state.finish()
  } else {
    abortClient(second.target)
    expect(await second.outcome).toBe('rejected:502')
    first.state.finish()
    await settle()
    expect(second.state.started).toBe(false)
    expect(third.state.started).toBe(true)
    third.state.finish()
  }
  await settle()
  // Both layers are free: ordinary and heavy work start at once.
  const ordinary = job(withUpstreamSlot)
  await settle()
  expect(ordinary.state.started).toBe(true)
  ordinary.state.finish()
  const heavy = job(withUpstreamSlot, HEAVY)
  await settle()
  expect(heavy.state.started).toBe(true)
  heavy.state.finish()
  await Promise.all([first.outcome, second.outcome, third.outcome, ordinary.outcome, heavy.outcome])
  expect(first.target.req.listenerCount('aborted')).toBe(0)
  expect(second.target.res.listenerCount('close')).toBe(0)
})

// The raw transport has its own timer; it must honour the heavy deadline too.
it('lets tenantTransport wait for a heavy upstream beyond 15s but not an ordinary one', async () => {
  vi.stubEnv('WEBVUE_TENANCY_MODE', 'shared')
  const token = 'synthetic-heavy-transport-token'.repeat(3)
  vi.stubEnv('WEBVUE_SHARED_PROXY_TOKEN', token)
  const directory = mkdtempSync(join(tmpdir(), 'webvue-heavy-transport-'))
  const registry = join(directory, 'registry.json')
  writeFileSync(registry, JSON.stringify({ schemaVersion: 1, snapshotRevision: 1, targets: [{ host: 'a.example.test', tenantId: 'a', database: 'db_a', filestore: 'db_a', registryRevision: 1, enabled: true }] }))
  vi.stubEnv('WEBVUE_TENANT_REGISTRY_PATH', registry)
  const { tenantTransport } = await load(32)
  const held = new Map<string, http.ServerResponse>()
  const server = http.createServer((req, res) => { req.resume(); held.set(req.url!, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const request = (path: string, heavy?: typeof HEAVY) => {
    const target = client()
    Object.assign(target.req, { headers: { host: 'a.example.test', 'x-webvue-proxy-token': token, 'x-webvue-tenant-revision': '1', cookie: 'session_id=synthetic' } })
    return tenantTransport(target.event, base, path, { heavy }).then(response => `status:${response.status}`, (error: { statusCode?: number }) => `rejected:${error.statusCode}`)
  }
  try {
    const heavy = request('/api/v1/heavy', HEAVY)
    const ordinary = request('/api/v1/ordinary')
    while (held.size < 2) await new Promise(resolve => setImmediate(resolve))
    await vi.advanceTimersByTimeAsync(WAIT_TIMEOUT)
    expect(await ordinary).toBe('rejected:502')
    held.get('/api/v1/heavy')!.end('{}')
    expect(await heavy).toBe('status:200')
  } finally {
    for (const res of held.values()) res.destroy()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(directory, { recursive: true })
  }
})
