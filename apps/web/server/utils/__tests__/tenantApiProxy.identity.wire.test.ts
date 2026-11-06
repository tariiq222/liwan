import http from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createApp, defineEventHandler, toNodeListener } from 'h3'

let upstream: http.Server
let app: http.Server
let upstreamUrl = ''
let url = ''
let calls = 0
let company = 1
let hold = false
const replies: Array<() => void> = []

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', defineEventHandler)
  vi.stubGlobal('useRuntimeConfig', () => ({ odooUrl: upstreamUrl }))
  vi.stubEnv('LIWAN_TENANCY_MODE', 'dedicated')
  const handler = (await import('../../routes/api/v1/[...path]')).default
  upstream = http.createServer((req, res) => {
    calls++
    const reply = () => {
      res.setHeader('content-type', 'application/json')
      res.setHeader('set-cookie', ['session_id=rotated; HttpOnly', 'preference=ar'])
      res.setHeader('cache-control', 'no-store')
      res.setHeader('connection', 'close, x-internal')
      res.setHeader('x-internal', 'hidden')
      res.end(JSON.stringify({ id: req.headers.cookie?.includes('other-user') ? 8 : 7, company: { id: company }, cookie: req.headers.cookie, lang: req.headers['accept-language'] }))
    }
    if (hold) replies.push(reply); else reply()
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
  const h3 = createApp().use(handler)
  app = http.createServer(toNodeListener(h3))
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(app.address() as { port: number }).port}`
})
afterAll(async () => {
  hold = false
  for (const reply of replies.splice(0)) reply()
  for (const server of [app, upstream]) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  vi.unstubAllGlobals(); vi.unstubAllEnvs()
})
const request = (session: string) => fetch(`${url}/api/v1/me`, { headers: { cookie: `session_id=${session}; preference=ar`, 'accept-language': 'en' } })

it('returns the cold request own authorized identity once, preserving cookies and selected locale', async () => {
  calls = 0
  const response = await request('cold-owner')
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ id: 7, company: { id: 1 }, cookie: 'session_id=cold-owner; preference=ar', lang: 'en' })
  expect(calls).toBe(1)
  expect(response.headers.getSetCookie()).toEqual(['session_id=rotated; HttpOnly', 'preference=ar'])
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('x-internal')).toBeNull()
})
it('never returns cached admission identity when company changes on a warm request', async () => {
  await request('warm-owner')
  calls = 0; company = 2
  const response = await request('warm-owner')
  expect((await response.json()).company.id).toBe(2)
  expect(calls).toBe(1)
})
it('shares admission only: concurrent consumers each obtain their own fresh me response', async () => {
  calls = 0; hold = true; company = 3
  const first = request('concurrent-owner')
  await vi.waitFor(() => expect(replies).toHaveLength(1))
  const second = request('concurrent-owner')
  await new Promise(resolve => setTimeout(resolve, 30))
  hold = false; replies.shift()!()
  const responses = await Promise.all([first, second])
  expect(await Promise.all(responses.map(response => response.json()))).toEqual([
    { id: 7, company: { id: 3 }, cookie: 'session_id=concurrent-owner; preference=ar', lang: 'en' },
    { id: 7, company: { id: 3 }, cookie: 'session_id=concurrent-owner; preference=ar', lang: 'en' },
  ])
  expect(calls).toBe(2)
})

it('does not reuse a previous session identity for another signed-in user', async () => {
  const response = await request('other-user')
  expect((await response.json()).id).toBe(8)
})
it('expires admission without retaining an application identity response', async () => {
  const clock = vi.spyOn(Date, 'now')
  const now = Date.now()
  try {
    clock.mockReturnValue(now)
    await request('expired-owner')
    calls = 0; company = 4
    clock.mockReturnValue(now + 15_001)
    const response = await request('expired-owner')
    expect((await response.json()).company.id).toBe(4)
    expect(calls).toBe(1)
  } finally { clock.mockRestore() }
})
it('does not substitute admission for conditional me or query response semantics', async () => {
  calls = 0
  const response = await fetch(`${url}/api/v1/me?fresh=1`, { headers: { cookie: 'session_id=query-owner', 'if-none-match': 'prior' } })
  expect(response.status).toBe(200)
  expect(calls).toBe(2)
})
it.each(['pending', 'disabled', 'revision'] as const)('refuses the cold identity response if tenant publication becomes %s during its probe', async kind => {
  const path = join(mkdtempSync(join(tmpdir(), 'liwan-cold-publication-')), 'registry.json')
  const target = { host: 'tenant.example.test', tenantId: 'tenant', database: 'tenant', filestore: 'tenant', enabled: true, registryRevision: 1 }
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, snapshotRevision: 1, targets: [target] }))
  vi.stubEnv('LIWAN_TENANCY_MODE', 'shared'); vi.stubEnv('LIWAN_SHARED_PROXY_TOKEN', 't'.repeat(40)); vi.stubEnv('LIWAN_TENANT_REGISTRY_PATH', path)
  hold = true; calls = 0
  try {
    // Native fetch owns Host; use a raw loopback request to model the trusted proxy hop.
    const pending = new Promise<number>((resolve, reject) => {
      const request = http.request(`${url}/api/v1/me`, { headers: { host: target.host, 'x-liwan-proxy-token': 't'.repeat(40), 'x-liwan-tenant-revision': '1', cookie: `session_id=publication-${kind}` } }, response => { response.resume(); resolve(response.statusCode!) })
      request.on('error', reject); request.end()
    })
    await vi.waitFor(() => expect(replies).toHaveLength(1))
    if (kind === 'pending') writeFileSync(`${path}.pending`, '')
    else writeFileSync(path, JSON.stringify({ schemaVersion: 1, snapshotRevision: 2, targets: [{ ...target, enabled: kind !== 'disabled', registryRevision: 2 }] }))
    hold = false; replies.shift()!()
    expect(await pending).toBe(403)
    expect(calls).toBe(1)
  } finally { hold = false; vi.stubEnv('LIWAN_TENANCY_MODE', 'dedicated') }
})
