import { afterEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { legacyTenantResponse, tenantTransport } from '../tenantTransport'

// Issue #557: the AI usage report carries the deployment's recorder key; nothing else the server sends to Odoo may carry an Authorization header.
const token = 'synthetic-wire-token'.repeat(3)
const key = `Bearer ${'a1'.repeat(20)}`
const usagePath = '/api/v1/ai/usage/service'

async function withOdoo(run: (context: { base: string; event: never; seen: http.IncomingHttpHeaders[] }) => Promise<void>) {
  const registry = join(mkdtempSync(join(tmpdir(), 'liwan-svc-')), 'registry.json')
  writeFileSync(registry, JSON.stringify({ schemaVersion: 1, snapshotRevision: 1, targets: [{ host: 'a.example.test', tenantId: 'a', database: 'db_a', filestore: 'db_a', registryRevision: 1, enabled: true }] }))
  vi.stubEnv('LIWAN_TENANCY_MODE', 'shared'); vi.stubEnv('LIWAN_SHARED_PROXY_TOKEN', token); vi.stubEnv('LIWAN_TENANT_REGISTRY_PATH', registry)
  const seen: http.IncomingHttpHeaders[] = []
  const server = http.createServer((req, res) => { seen.push(req.headers); req.resume(); res.setHeader('content-type', 'application/json'); res.end('{}') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  // The request is a user's own: it carries their session cookie and, forged, an Authorization header.
  const req = Object.assign(new EventEmitter(), { headers: { host: 'a.example.test', 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '1', cookie: 'session_id=signed-envelope', authorization: 'Bearer browser-supplied' } })
  try { await run({ base, event: { node: { req, res: new EventEmitter() } } as never, seen }) } finally { await new Promise(resolve => server.close(resolve)) }
}
afterEach(() => vi.unstubAllEnvs())

describe('tenantTransport authorization (recorder key)', () => {
  it('sends the key on the exact usage report, without the user cookie or a browser header, still bound to the tenant', async () => {
    await withOdoo(async ({ base, event, seen }) => {
      const response = await tenantTransport(event, base, usagePath, { method: 'POST', body: '{}', headers: { cookie: '', 'content-type': 'application/json' }, authorization: key })
      expect(response.status).toBe(200)
      expect(seen).toHaveLength(1)
      expect(seen[0]!.authorization).toBe(key)
      expect(seen[0]!.cookie).toBeUndefined()
      expect([seen[0]!.host, seen[0]!['x-liwan-proxy-token'], seen[0]!['x-liwan-tenant-revision']]).toEqual(['a.example.test', token, '1'])
    })
  })

  it('never forwards the Authorization header of the incoming request, on any path', async () => {
    await withOdoo(async ({ base, event, seen }) => {
      for (const [method, path] of [['GET', '/api/v1/me'], ['POST', usagePath], ['POST', '/api/v1/ai/usage'], ['POST', '/api/v1/ai/audit']] as const) {
        await tenantTransport(event, base, path, { method, body: method === 'POST' ? '{}' : undefined })
      }
      expect(seen).toHaveLength(4)
      for (const headers of seen) expect(headers.authorization).toBeUndefined()
      expect(seen.every(headers => headers.cookie === 'session_id=signed-envelope')).toBe(true)
    })
  })

  it('refuses the key on any other path, spelling or method, before anything is sent', async () => {
    await withOdoo(async ({ base, event, seen }) => {
      const near: [string, string][] = [
        ['GET', usagePath], ['PUT', usagePath], ['PATCH', usagePath], ['DELETE', usagePath], ['HEAD', usagePath],
        ['POST', `${usagePath}/`], ['POST', usagePath.toUpperCase()], ['POST', `${usagePath}?x=1`], ['POST', `${usagePath}/../x`], ['POST', '/api/v1/ai/usage/./service'],
        ['POST', '/api/v1/ai/usage'], ['POST', '/api/v1/ai/audit'], ['GET', '/api/v1/me'], ['POST', '/api/v1/ai/usage/%73ervice'], ['POST', '/json/2/liwan.ai.usage/create'],
      ]
      for (const [method, path] of near) await expect(tenantTransport(event, base, path, { method, body: '{}', authorization: key }), `${method} ${path}`).rejects.toThrow('tenant_upstream_unavailable')
      for (const bad of ['Bearer x', 'Basic ' + 'a1'.repeat(20), `Bearer ${'a1'.repeat(20)} extra`, '', 'Bearer browser-supplied']) {
        await expect(tenantTransport(event, base, usagePath, { method: 'POST', body: '{}', authorization: bad }), bad).rejects.toThrow('tenant_upstream_unavailable')
      }
      expect(seen).toHaveLength(0)
    })
  })

  it('does not take the key from the headers option', async () => {
    await withOdoo(async ({ base, event, seen }) => {
      await tenantTransport(event, base, usagePath, { method: 'POST', body: '{}', headers: { authorization: key } })
      expect(seen[0]!.authorization).toBeUndefined()
    })
  })
})

describe('legacyTenantResponse (dedicated browser proxy)', () => {
  it('drops the Authorization and Proxy-Authorization headers of the browser on every path and keeps the cookie', async () => {
    vi.stubEnv('LIWAN_TENANCY_MODE', 'dedicated'); vi.stubEnv('LIWAN_RELEASE_ROUTES_DIR', '')
    const seen: http.IncomingHttpHeaders[] = []
    const server = http.createServer((req, res) => { seen.push(req.headers); req.resume(); res.setHeader('content-type', 'application/json'); res.end('{}') })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const event = { node: { req: Object.assign(new EventEmitter(), { headers: {} }), res: new EventEmitter() } } as never
    try {
      for (const path of ['/api/v1/me', '/api/v1/tasks?x=1', usagePath]) {
        await legacyTenantResponse(event, base, path, { method: 'POST', body: Buffer.from('{}'), headers: { cookie: 'session_id=s1', authorization: 'Bearer browser-supplied', 'proxy-authorization': 'Basic abc', 'content-type': 'application/json' } })
      }
      expect(seen).toHaveLength(3)
      for (const headers of seen) {
        expect(headers.authorization).toBeUndefined()
        expect(headers['proxy-authorization']).toBeUndefined()
        expect(headers.cookie).toBe('session_id=s1')
      }
    } finally { await new Promise(resolve => server.close(resolve)) }
  })
})
