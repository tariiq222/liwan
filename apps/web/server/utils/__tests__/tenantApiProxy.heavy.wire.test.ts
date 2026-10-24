import http from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineEventHandler, toNodeListener } from 'h3'

const COOKIE = 'session_id=valid-heavy-session'
const HEAVY_READ = '/api/v1/finance/reports/trial-balance'
const HEAVY_WRITE = '/api/v1/finance/invoices/3/post'
const ORDINARY_PATH = '/api/v1/tasks'
const HEAVY_TIMEOUT = 60_000
const WAIT_TIMEOUT = 15_000
const TENANT_HOST = 'a.example.test'
const PROXY_TOKEN = 'synthetic-heavy-wire-token'.repeat(3)
// Heavy admission pool: two credits run, eight more wait (see bufferAdmission POOL_LIMITS).
const HEAVY_CREDITS = 2
const HEAVY_QUEUE = 8

let upstream: http.Server
let app: http.Server
let url: string
let registryDirectory: string
let mode: 'dedicated' | 'shared' = 'dedicated'
let held: Array<{ url: string; res: http.ServerResponse }> = []
let reached: string[] = []
let closedByClient: string[] = []

beforeAll(async () => {
  let upstreamUrl = ''
  vi.stubGlobal('defineEventHandler', defineEventHandler)
  vi.stubGlobal('useRuntimeConfig', () => ({ get odooUrl() { return upstreamUrl }, authProxyClientIpHeader: '' }))
  const handler = (await import('../../routes/api/v1/[...path]')).default
  upstream = http.createServer((req, res) => {
    req.resume()
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/v1/me') { res.end(JSON.stringify({ id: 7, company: { id: 1 } })); return }
    reached.push(req.url!)
    // Only requests that ask to be held wait for the test to answer them.
    if (req.url!.includes('hold=1')) held.push({ url: req.url!, res }); else res.end('{}')
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
  const h3 = createApp()
  h3.use(handler)
  app = http.createServer(toNodeListener(h3))
  app.on('request', (req, res) => { res.once('close', () => closedByClient.push(req.url!)) })
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(app.address() as { port: number }).port}`
  registryDirectory = mkdtempSync(join(tmpdir(), 'webvue-heavy-wire-'))
  writeFileSync(join(registryDirectory, 'registry.json'), JSON.stringify({ schemaVersion: 1, snapshotRevision: 1, targets: [{ host: TENANT_HOST, tenantId: 'a', database: 'db_a', filestore: 'db_a', registryRevision: 1, enabled: true }] }))
})
beforeEach(() => { held = []; reached = []; closedByClient = [] })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
afterAll(async () => {
  for (const server of [app, upstream]) {
    server?.closeAllConnections()
    if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  }
  rmSync(registryDirectory, { recursive: true })
  vi.unstubAllGlobals()
})

/** Dedicated mode reaches Odoo through the legacy fetch transport; shared mode through the bound raw transport. */
function useMode(selected: typeof mode) {
  mode = selected
  vi.stubEnv('WEBVUE_TENANCY_MODE', selected)
  if (selected === 'shared') {
    vi.stubEnv('WEBVUE_SHARED_PROXY_TOKEN', PROXY_TOKEN)
    vi.stubEnv('WEBVUE_TENANT_REGISTRY_PATH', join(registryDirectory, 'registry.json'))
  }
}

type Reply = { status: number; body?: { data?: { code?: string } } }
/** Plain http.request, because fetch cannot set the Host header shared mode resolves the tenant from. */
const call = (path: string, options: { method?: string; signal?: AbortSignal } = {}) => new Promise<Reply>((resolve, reject) => {
  const headers: Record<string, string> = { cookie: COOKIE }
  if (mode === 'shared') Object.assign(headers, { host: TENANT_HOST, 'x-webvue-proxy-token': PROXY_TOKEN, 'x-webvue-tenant-revision': '1' })
  const request = http.request(`${url}${path}`, { method: options.method ?? 'GET', headers, signal: options.signal, agent: false }, response => {
    const chunks: Buffer[] = []
    response.on('data', chunk => chunks.push(chunk))
    response.on('end', () => {
      let body: Reply['body']
      try { body = JSON.parse(Buffer.concat(chunks).toString()) } catch { body = undefined }
      resolve({ status: response.statusCode!, body })
    })
  })
  request.on('error', reject)
  request.end(options.method === 'POST' ? '{}' : undefined)
})
const get = (path: string, signal?: AbortSignal) => call(path, { signal })
const post = (path: string, signal?: AbortSignal) => call(path, { method: 'POST', signal })
const held1 = (path: string) => `${path}?hold=1`
const answer = (index: number) => held[index]!.res.end('{}')
/** Real-time wait for socket events while timers are fake. */
const until = async (condition: () => boolean) => { while (!condition()) await new Promise(resolve => setImmediate(resolve)) }

describe.each(['dedicated', 'shared'] as const)('heavy API routes over the %s transport', selected => {
  beforeEach(() => useMode(selected))

  // A route that is not allowlisted keeps the ordinary 15s admitted deadline.
  it('fails an ordinary route at 15s but lets an allowlisted heavy route answer after 40s', async () => {
    await call(ORDINARY_PATH)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const ordinary = call(held1(ORDINARY_PATH))
    const heavy = call(held1(HEAVY_READ))
    await until(() => held.length === 2)
    await vi.advanceTimersByTimeAsync(WAIT_TIMEOUT)
    expect(await ordinary).toMatchObject({ status: 502, body: { data: { code: 'tenant_upstream_unavailable' } } })
    await vi.advanceTimersByTimeAsync(40_000 - WAIT_TIMEOUT)
    answer(held.findIndex(item => item.url.startsWith(HEAVY_READ)))
    expect((await heavy).status).toBe(200)
  })

  it('cuts a heavy route off at the heavy deadline with the structured 502', async () => {
    await call(ORDINARY_PATH)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const heavy = call(held1(HEAVY_READ))
    await until(() => held.length === 1)
    await vi.advanceTimersByTimeAsync(HEAVY_TIMEOUT)
    expect(await heavy).toMatchObject({ status: 502, body: { data: { code: 'tenant_upstream_unavailable' } } })
  })

  // Odoo decodes escapes and ignores one trailing slash, so these reach the heavy route: they must get its budget
  // and the upstream must see the one canonical spelling that was classified.
  it.each([
    ['GET', `${HEAVY_READ}/`, HEAVY_READ],
    ['GET', '/api/v1/finance/reports/trial%2Dbalance', HEAVY_READ],
    ['GET', '/api/v1/finance/reports/%74rial%2dbalance/', HEAVY_READ],
    ['POST', '/api/v1/finance/invoices/%33/post', HEAVY_WRITE],
    ['POST', `${HEAVY_WRITE}/`, HEAVY_WRITE],
  ])('gives %s %s the heavy deadline and forwards the canonical path', async (method, raw, canonical) => {
    await call(ORDINARY_PATH)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const heavy = call(`${raw}?hold=1&a=%2F%5c`, { method })
    await until(() => held.length === 1)
    expect(held[0]!.url).toBe(`${canonical}?hold=1&a=%2F%5c`)
    await vi.advanceTimersByTimeAsync(40_000)
    answer(0)
    expect((await heavy).status).toBe(200)
  })

  it.each([
    '/api/v1/finance/reports%2Ftrial-balance',
    '/api/v1/finance/reports%2ftrial-balance',
    '/api/v1/finance/reports%5Ctrial-balance',
    '/api/v1/finance/reports/%00',
    '/api/v1/finance/reports/%zz',
    '/api/v1/finance/reports//trial-balance',
  ])('refuses %s with a 400 invalid_path that never reaches Odoo', async path => {
    expect(await call(path)).toMatchObject({ status: 400, body: { data: { code: 'invalid_path' } } })
    expect(await post(path)).toMatchObject({ status: 400 })
    expect(reached).toEqual([])
  })

  it('leaves ordinary calls and their query strings untouched', async () => {
    expect((await call(`${ORDINARY_PATH}?q=%2F%20a&x=1`)).status).toBe(200)
    expect(reached).toEqual([`${ORDINARY_PATH}?q=%2F%20a&x=1`])
  })

  // With a single-slot gate on reads, the second report would wait for the first.
  it('runs two heavy reads at once and lets a third wait past 15s for a credit', async () => {
    await call(ORDINARY_PATH)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const first = call(held1(HEAVY_READ))
    const second = call(held1(HEAVY_READ))
    await until(() => held.length === HEAVY_CREDITS)
    const third = call(held1(HEAVY_READ))
    await vi.advanceTimersByTimeAsync(WAIT_TIMEOUT + 5_000)
    expect(held).toHaveLength(HEAVY_CREDITS)
    answer(0)
    expect((await first).status).toBe(200)
    await until(() => held.length === 3)
    answer(1); answer(2)
    expect([(await second).status, (await third).status]).toEqual([200, 200])
  })

  it('serialises heavy writes and does not fail the second one at 15s while the first runs for 20s', async () => {
    await call(ORDINARY_PATH)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const first = post(held1(HEAVY_WRITE))
    await until(() => held.length === 1)
    const second = post(held1(HEAVY_WRITE))
    await vi.advanceTimersByTimeAsync(20_000)
    expect(held).toHaveLength(1)
    answer(0)
    expect((await first).status).toBe(200)
    await until(() => held.length === 2)
    answer(1)
    expect((await second).status).toBe(200)
  })

  it('does not hold a heavy read behind a running heavy write, nor ordinary work behind either', async () => {
    await call(ORDINARY_PATH)
    const write = post(held1(HEAVY_WRITE))
    await until(() => held.length === 1)
    const read = call(held1(HEAVY_READ))
    await until(() => held.length === 2)
    // Both heavy credits are in use; ordinary work has its own pool.
    expect((await call(ORDINARY_PATH)).status).toBe(200)
    answer(0); answer(1)
    expect([(await write).status, (await read).status]).toEqual([200, 200])
  })

  // The 11th heavy request finds two running and eight waiting, and is refused at once instead of queueing.
  it('refuses heavy requests beyond the credits and queue, then recovers with nothing leaked', async () => {
    await call(ORDINARY_PATH)
    const accepted = Array.from({ length: HEAVY_CREDITS + HEAVY_QUEUE }, () => call(held1(HEAVY_READ)))
    await until(() => held.length === HEAVY_CREDITS)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(await call(held1(HEAVY_READ))).toMatchObject({ status: 502, body: { data: { code: 'tenant_upstream_unavailable' } } })
    for (let index = 0; index < accepted.length; index++) {
      await until(() => held.length > index)
      answer(index)
    }
    expect((await Promise.all(accepted)).map(reply => reply.status)).toEqual(Array(accepted.length).fill(200))
    expect((await call(HEAVY_READ)).status).toBe(200)
  })

  // A queued write whose browser left must neither reach Odoo later nor keep the gate or a credit.
  it('drops a queued heavy write when its browser disconnects', async () => {
    await call(ORDINARY_PATH)
    const first = post(held1(HEAVY_WRITE))
    await until(() => held.length === 1)
    const leaving = new AbortController()
    const abandoned = post(`${held1(HEAVY_WRITE)}&who=abandoned`, leaving.signal).catch(() => 'aborted')
    const third = post(held1(HEAVY_WRITE))
    await new Promise(resolve => setTimeout(resolve, 50))
    leaving.abort()
    expect(await abandoned).toBe('aborted')
    // Answering earlier would race the server noticing the disconnect.
    await until(() => closedByClient.some(closed => closed.includes('who=abandoned')))
    await new Promise(resolve => setImmediate(resolve))
    answer(0)
    expect((await first).status).toBe(200)
    await until(() => held.length === 2)
    expect(held[1]!.url).toBe(held1(HEAVY_WRITE))
    answer(1)
    expect((await third).status).toBe(200)
    expect(reached.some(item => item.includes('who=abandoned'))).toBe(false)
  })

  it.each([['read', get], ['write', post]] as const)('releases the credit and gate when the browser of a running heavy %s disconnects', async (_kind, send) => {
    await call(ORDINARY_PATH)
    const path = send === post ? HEAVY_WRITE : HEAVY_READ
    const leaving = new AbortController()
    const abandoned = send(held1(path), leaving.signal).catch(() => 'aborted')
    await until(() => held.length === 1)
    const closed = new Promise<void>(resolve => held[0]!.res.once('close', resolve))
    leaving.abort()
    expect(await abandoned).toBe('aborted')
    await closed
    // Two later calls need both credits and (for a write) the gate.
    const later = [send(path), send(path)]
    expect((await Promise.all(later)).map(reply => reply.status)).toEqual([200, 200])
  })
})
