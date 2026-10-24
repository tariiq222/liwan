import http from 'node:http'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import { HEAVY_CREDITS } from '../bufferAdmission.mjs'
import type { HeavyBudget } from '../tenantTransport'

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.resetModules() })

const HEAVY_WRITE = { timeoutMs: 40_000, write: true }
const HEAVY_READ = { timeoutMs: 40_000, write: false }
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
function job(withUpstreamSlot: Awaited<ReturnType<typeof load>>['withUpstreamSlot'], budget?: HeavyBudget, target = client()) {
  const state = { started: false, aborted: false, finish: () => {} }
  const outcome = withUpstreamSlot(signal => new Promise<string>((resolve, reject) => {
    state.started = true
    state.finish = () => resolve('done')
    signal.addEventListener('abort', () => { state.aborted = true; reject(new Error('aborted')) }, { once: true })
  }), target.event, budget).then(value => value, (error: { statusCode?: number }) => `rejected:${error.statusCode}`)
  return { state, outcome, target }
}
const settle = () => vi.advanceTimersByTimeAsync(0)

// With no write gate, a second heavy write would start beside the first.
it('admits one heavy write at a time, while ordinary work still runs beside it', async () => {
  const { withUpstreamSlot } = await load(32)
  const first = job(withUpstreamSlot, HEAVY_WRITE)
  const second = job(withUpstreamSlot, HEAVY_WRITE)
  const ordinary = job(withUpstreamSlot)
  await settle()
  expect([first.state.started, second.state.started, ordinary.state.started]).toEqual([true, false, true])
  first.state.finish(); ordinary.state.finish()
  await settle()
  expect(second.state.started).toBe(true)
  second.state.finish()
  expect(await Promise.all([first.outcome, second.outcome, ordinary.outcome])).toEqual(['done', 'done', 'done'])
})

// Reads are not serialised: with the single-slot gate on reads, only the first would have started.
it('runs heavy reads concurrently and beside a running heavy write', async () => {
  const { withUpstreamSlot } = await load(32)
  const write = job(withUpstreamSlot, HEAVY_WRITE)
  const reads = Array.from({ length: 5 }, () => job(withUpstreamSlot, HEAVY_READ))
  await settle()
  expect([write, ...reads].map(item => item.state.started)).toEqual(Array(6).fill(true))
  for (const item of [write, ...reads]) item.state.finish()
  expect(await Promise.all([write, ...reads].map(item => item.outcome))).toEqual(Array(6).fill('done'))
})

// Without taking an ordinary slot too, heavy work would bypass the global limit.
it.each([['write', HEAVY_WRITE], ['read', HEAVY_READ]] as const)('also takes an ordinary upstream slot for a heavy %s, so the global limit applies', async (_kind, budget) => {
  const { withUpstreamSlot } = await load(1)
  const ordinary = job(withUpstreamSlot)
  const heavy = job(withUpstreamSlot, budget)
  const next = job(withUpstreamSlot, budget)
  await settle()
  expect([heavy.state.started, next.state.started]).toEqual([false, false])
  ordinary.state.finish()
  await settle()
  expect([heavy.state.started, next.state.started]).toEqual([true, false])
  heavy.state.finish()
  await settle()
  next.state.finish()
  expect(await Promise.all([ordinary.outcome, heavy.outcome, next.outcome])).toEqual(['done', 'done', 'done'])
})

// Ordinary work gets 15s of admitted time; only the heavy budget extends it.
it.each([['write', HEAVY_WRITE], ['read', HEAVY_READ]] as const)('applies the heavy deadline to an admitted heavy %s and 15s to ordinary work', async (_kind, budget) => {
  const { withUpstreamSlot } = await load(32)
  const heavy = job(withUpstreamSlot, budget)
  const ordinary = job(withUpstreamSlot)
  await settle()
  await vi.advanceTimersByTimeAsync(15_000)
  expect([ordinary.state.aborted, heavy.state.aborted]).toEqual([true, false])
  expect(await ordinary.outcome).toBe('rejected:undefined')
  await vi.advanceTimersByTimeAsync(budget.timeoutMs - 15_000)
  expect(heavy.state.aborted).toBe(true)
  expect(await heavy.outcome).toBe('rejected:undefined')
})

// A write queued behind a long write must not give up at the ordinary 15s; it has the heavy budget.
it('lets a queued heavy write wait past 15s for the running write, then start', async () => {
  const { withUpstreamSlot } = await load(32)
  const first = job(withUpstreamSlot, HEAVY_WRITE)
  const second = job(withUpstreamSlot, HEAVY_WRITE)
  await vi.advanceTimersByTimeAsync(20_000)
  expect([first.state.aborted, second.state.started]).toEqual([false, false])
  first.state.finish()
  await settle()
  expect(second.state.started).toBe(true)
  second.state.finish()
  expect(await Promise.all([first.outcome, second.outcome])).toEqual(['done', 'done'])
})

// The heavy credits allow one running write plus this many waiting; a longer queue could never fill.
it('sizes the write queue to what the heavy credits can reach', async () => {
  const { withUpstreamSlot } = await load(32)
  const running = job(withUpstreamSlot, HEAVY_WRITE)
  const queued = Array.from({ length: HEAVY_CREDITS - 1 }, () => job(withUpstreamSlot, HEAVY_WRITE))
  await settle()
  const overflow = job(withUpstreamSlot, HEAVY_WRITE)
  expect(await overflow.outcome).toBe('rejected:502')
  expect(overflow.state.started).toBe(false)
  running.state.finish()
  // The gate is idle again after the queue drains: a later write is admitted immediately and the queue refills.
  for (const item of queued) { await settle(); item.state.finish() }
  expect(await Promise.all([running.outcome, ...queued.map(item => item.outcome)])).toEqual(Array(HEAVY_CREDITS).fill('done'))
  const later = job(withUpstreamSlot, HEAVY_WRITE)
  const refill = Array.from({ length: HEAVY_CREDITS - 1 }, () => job(withUpstreamSlot, HEAVY_WRITE))
  await settle()
  expect(later.state.started).toBe(true)
  expect(refill.some(item => item.state.started)).toBe(false)
  later.state.finish()
  for (const item of refill) { await settle(); item.state.finish() }
  expect(await Promise.all([later.outcome, ...refill.map(item => item.outcome)])).toEqual(Array(HEAVY_CREDITS).fill('done'))
})

// The gate holder can outlast a waiter when it first had to wait for an ordinary slot; the waiter then gives up
// at the heavy budget (not at 15s), removes itself and leaves the running write alone.
it('times a queued heavy write out at the heavy budget with a 502 and leaks nothing', async () => {
  const { withUpstreamSlot } = await load(1)
  const ordinary = job(withUpstreamSlot)
  const running = job(withUpstreamSlot, HEAVY_WRITE)
  const queued = job(withUpstreamSlot, HEAVY_WRITE)
  await settle()
  await vi.advanceTimersByTimeAsync(WAIT_TIMEOUT - 1_000)
  ordinary.state.finish()
  await settle()
  expect(running.state.started).toBe(true)
  await vi.advanceTimersByTimeAsync(HEAVY_WRITE.timeoutMs - (WAIT_TIMEOUT - 1_000) - 1)
  expect(queued.state.started).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(await queued.outcome).toBe('rejected:502')
  expect(queued.state.started).toBe(false)
  expect(running.state.aborted).toBe(false)
  running.state.finish()
  expect(await running.outcome).toBe('done')
  expect(queued.target.res.listenerCount('close')).toBe(0)
  const later = job(withUpstreamSlot, HEAVY_WRITE)
  await settle()
  expect(later.state.started).toBe(true)
  later.state.finish()
  expect(await later.outcome).toBe('done')
})

// Heavy reads wait for an ordinary slot only as long as any ordinary request does.
it('refuses a heavy read that finds no ordinary slot within 15s', async () => {
  const { withUpstreamSlot } = await load(1)
  const holder = job(withUpstreamSlot)
  const read = job(withUpstreamSlot, HEAVY_READ)
  await vi.advanceTimersByTimeAsync(WAIT_TIMEOUT)
  expect(await read.outcome).toBe('rejected:502')
  expect(read.state.started).toBe(false)
  holder.state.finish()
  await holder.outcome
  const later = job(withUpstreamSlot, HEAVY_READ)
  await settle()
  expect(later.state.started).toBe(true)
  later.state.finish()
  await later.outcome
})

// The write gate is taken before the ordinary slot; a failed ordinary acquire must give it back.
it('releases the write gate when the ordinary slot cannot be had', async () => {
  const { withUpstreamSlot } = await load(1)
  // A heavy read holds the only ordinary slot beyond 15s, so the 15s deadline cannot free it first.
  const holder = job(withUpstreamSlot, HEAVY_READ)
  const write = job(withUpstreamSlot, HEAVY_WRITE)
  await settle()
  await vi.advanceTimersByTimeAsync(WAIT_TIMEOUT)
  expect(await write.outcome).toBe('rejected:502')
  holder.state.finish()
  await holder.outcome
  const later = job(withUpstreamSlot, HEAVY_WRITE)
  await settle()
  expect(later.state.started).toBe(true)
  later.state.finish()
  await later.outcome
})

// A leaked waiter would later receive the gate and run abandoned work; a leaked count would block it forever.
it.each(['aborted', 'running'] as const)('releases the write gate and the ordinary slot when a %s heavy write disconnects', async state => {
  const { withUpstreamSlot } = await load(1)
  const first = job(withUpstreamSlot, HEAVY_WRITE)
  const second = job(withUpstreamSlot, HEAVY_WRITE)
  await settle()
  if (state === 'running') {
    abortClient(first.target)
    await settle()
    expect(first.state.aborted).toBe(true)
    expect(await first.outcome).toBe('rejected:undefined')
    expect(second.state.started).toBe(true)
    second.state.finish()
  } else {
    abortClient(second.target)
    expect(await second.outcome).toBe('rejected:502')
    first.state.finish()
    await settle()
    expect(second.state.started).toBe(false)
  }
  await settle()
  // Both layers are free: ordinary work and a heavy write start at once.
  const ordinary = job(withUpstreamSlot)
  await settle()
  expect(ordinary.state.started).toBe(true)
  ordinary.state.finish()
  const heavy = job(withUpstreamSlot, HEAVY_WRITE)
  await settle()
  expect(heavy.state.started).toBe(true)
  heavy.state.finish()
  await Promise.all([first.outcome, second.outcome, ordinary.outcome, heavy.outcome])
  expect(first.target.req.listenerCount('aborted')).toBe(0)
  expect(second.target.res.listenerCount('close')).toBe(0)
})

it('cancels a running heavy read when its client disconnects and frees the ordinary slot', async () => {
  const { withUpstreamSlot } = await load(1)
  const read = job(withUpstreamSlot, HEAVY_READ)
  const next = job(withUpstreamSlot, HEAVY_READ)
  await settle()
  expect([read.state.started, next.state.started]).toEqual([true, false])
  abortClient(read.target)
  await settle()
  expect(read.state.aborted).toBe(true)
  expect(await read.outcome).toBe('rejected:undefined')
  expect(next.state.started).toBe(true)
  next.state.finish()
  await next.outcome
  expect(read.target.req.listenerCount('aborted')).toBe(0)
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
  const request = (path: string, heavy?: HeavyBudget) => {
    const target = client()
    Object.assign(target.req, { headers: { host: 'a.example.test', 'x-webvue-proxy-token': token, 'x-webvue-tenant-revision': '1', cookie: 'session_id=synthetic' } })
    return tenantTransport(target.event, base, path, { heavy }).then(response => `status:${response.status}`, (error: { statusCode?: number }) => `rejected:${error.statusCode}`)
  }
  try {
    const write = request('/api/v1/heavy-write', HEAVY_WRITE)
    const read = request('/api/v1/heavy-read', HEAVY_READ)
    const ordinary = request('/api/v1/ordinary')
    while (held.size < 3) await new Promise(resolve => setImmediate(resolve))
    await vi.advanceTimersByTimeAsync(WAIT_TIMEOUT)
    expect(await ordinary).toBe('rejected:502')
    held.get('/api/v1/heavy-write')!.end('{}')
    held.get('/api/v1/heavy-read')!.end('{}')
    expect(await Promise.all([write, read])).toEqual(['status:200', 'status:200'])
  } finally {
    for (const res of held.values()) res.destroy()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(directory, { recursive: true })
  }
})
