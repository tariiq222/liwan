import http from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineEventHandler, toNodeListener } from 'h3'

const COOKIE = 'session_id=valid-heavy-session'
const HEAVY_PATH = '/api/v1/finance/reports/trial-balance'
const ORDINARY_PATH = '/api/v1/tasks'
const HEAVY_TIMEOUT = 60_000
const WAIT_TIMEOUT = 15_000

let upstream: http.Server
let app: http.Server
let url: string
let held: Array<{ url: string; res: http.ServerResponse }> = []
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
})
beforeEach(() => { held = []; closedByClient = []; vi.stubEnv('WEBVUE_TENANCY_MODE', 'dedicated') })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
afterAll(async () => {
  for (const server of [app, upstream]) {
    server?.closeAllConnections()
    if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  }
  vi.unstubAllGlobals()
})

const call = (path: string, signal?: AbortSignal) => fetch(`${url}${path}`, { headers: { cookie: COOKIE }, signal })
const held1 = (path: string) => `${path}?hold=1`
const ABANDONED = `${held1(HEAVY_PATH)}&who=abandoned`
const answer = (index: number) => held[index]!.res.end('{}')
/** Real-time wait for socket events while timers are fake. */
const until = async (condition: () => boolean) => { while (!condition()) await new Promise(resolve => setImmediate(resolve)) }
const outcome = async (request: Promise<Response>) => {
  const response = await request
  return { status: response.status, body: await response.json().catch(() => undefined) as { data?: { code?: string } } | undefined }
}

// A route that is not allowlisted keeps the ordinary 15s admitted deadline.
it('fails an ordinary route at 15s but lets an allowlisted heavy route answer after 40s', async () => {
  await call(ORDINARY_PATH)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const ordinary = outcome(call(held1(ORDINARY_PATH)))
  const heavy = outcome(call(held1(HEAVY_PATH)))
  await until(() => held.length === 2)
  await vi.advanceTimersByTimeAsync(WAIT_TIMEOUT)
  expect(await ordinary).toMatchObject({ status: 502, body: { data: { code: 'tenant_upstream_unavailable' } } })
  await vi.advanceTimersByTimeAsync(40_000 - WAIT_TIMEOUT)
  answer(held.findIndex(item => item.url.startsWith(HEAVY_PATH)))
  expect((await heavy).status).toBe(200)
})

it('cuts a heavy route off at the heavy deadline with the structured 502', async () => {
  await call(ORDINARY_PATH)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const heavy = outcome(call(held1(HEAVY_PATH)))
  await until(() => held.length === 1)
  await vi.advanceTimersByTimeAsync(HEAVY_TIMEOUT)
  expect(await heavy).toMatchObject({ status: 502, body: { data: { code: 'tenant_upstream_unavailable' } } })
})

it('serves ordinary work while a second heavy request waits for the first', async () => {
  await call(ORDINARY_PATH)
  const first = outcome(call(held1(HEAVY_PATH)))
  await until(() => held.length === 1)
  const second = outcome(call(held1(HEAVY_PATH)))
  expect((await call(ORDINARY_PATH)).status).toBe(200)
  // The waiting heavy request has not reached Odoo, and still has not once ordinary work completed.
  expect(held).toHaveLength(1)
  answer(0)
  expect((await first).status).toBe(200)
  await until(() => held.length === 2)
  answer(1)
  expect((await second).status).toBe(200)
})

it('gives up a waiting heavy request after 15s, leaves the running one alone and recovers', async () => {
  await call(ORDINARY_PATH)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const first = outcome(call(held1(HEAVY_PATH)))
  await until(() => held.length === 1)
  const second = outcome(call(held1(HEAVY_PATH)))
  await vi.advanceTimersByTimeAsync(WAIT_TIMEOUT)
  expect(await second).toMatchObject({ status: 502, body: { data: { code: 'tenant_upstream_unavailable' } } })
  expect(held).toHaveLength(1)
  answer(0)
  expect((await first).status).toBe(200)
  vi.useRealTimers()
  expect((await call(HEAVY_PATH)).status).toBe(200)
  expect(held).toHaveLength(1)
})

// A queued request whose browser left must neither reach Odoo later nor keep the gate.
it('drops a queued heavy request when its browser disconnects', async () => {
  await call(ORDINARY_PATH)
  const first = outcome(call(held1(HEAVY_PATH)))
  await until(() => held.length === 1)
  const leaving = new AbortController()
  const abandoned = call(ABANDONED, leaving.signal).catch(() => 'aborted')
  const third = outcome(call(held1(HEAVY_PATH)))
  await new Promise(resolve => setTimeout(resolve, 50))
  leaving.abort()
  expect(await abandoned).toBe('aborted')
  // Answering earlier would race the server noticing the disconnect.
  await until(() => closedByClient.includes(ABANDONED))
  await new Promise(resolve => setImmediate(resolve))
  answer(0)
  expect((await first).status).toBe(200)
  await until(() => held.length === 2)
  expect(held[1]!.url).toBe(held1(HEAVY_PATH))
  answer(1)
  expect((await third).status).toBe(200)
  expect(held).toHaveLength(2)
})

it('releases the gate when the browser of a running heavy request disconnects', async () => {
  await call(ORDINARY_PATH)
  const leaving = new AbortController()
  const abandoned = call(held1(HEAVY_PATH), leaving.signal).catch(() => 'aborted')
  await until(() => held.length === 1)
  const closed = new Promise<void>(resolve => held[0]!.res.once('close', resolve))
  leaving.abort()
  expect(await abandoned).toBe('aborted')
  await closed
  expect((await call(HEAVY_PATH)).status).toBe(200)
})
