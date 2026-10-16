import { it, expect, vi } from 'vitest'
import http from 'node:http'
import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tenantTransport } from '../tenantTransport'

it('strict receiving socket sees tenant Host/token/revision for API and all session flows', async () => {
  const token = 'synthetic-wire-token'.repeat(3)
  const path = join(mkdtempSync(join(tmpdir(), 'webvue-wire-')), 'registry.json')
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, snapshotRevision: 1, targets: [{ host: 'a.example.test', tenantId: 'a', database: 'db_a', filestore: 'db_a', registryRevision: 1, enabled: true }] }))
  vi.stubEnv('WEBVUE_TENANCY_MODE', 'shared'); vi.stubEnv('WEBVUE_SHARED_PROXY_TOKEN', token); vi.stubEnv('WEBVUE_TENANT_REGISTRY_PATH', path)
  const calls: http.IncomingHttpHeaders[] = []; let destroyed = false
  let sawAbortRequest: () => void = () => {}
  let sawAbortClose: () => void = () => {}
  const abortRequest = new Promise<void>(resolve => { sawAbortRequest = resolve })
  const abortClose = new Promise<void>(resolve => { sawAbortClose = resolve })
  const server = http.createServer((req, res) => {
    calls.push(req.headers)
    if (req.headers.host !== 'a.example.test' || req.headers['x-webvue-proxy-token'] !== token || req.headers['x-webvue-tenant-revision'] !== '1') { res.writeHead(403); res.end(); return }
    req.resume()
    if (req.url === '/api/v1/abort') { res.once('close', sawAbortClose); sawAbortRequest(); return }
    if (req.url === '/api/v1/redirect') { res.writeHead(302, { location: 'http://forbidden.invalid' }); res.end(); return }
    if (req.url === '/web/session/destroy') destroyed = true
    res.setHeader('set-cookie', ['session_id=synthetic; HttpOnly', 'second=fixture; HttpOnly'])
    res.setHeader('content-type', 'application/octet-stream')
    res.statusCode = req.url === '/api/v1/missing' ? 404 : 200
    res.end(Buffer.from([0, 1, 255, 128]))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const req = Object.assign(new EventEmitter(), { headers: { host: 'a.example.test', 'x-webvue-proxy-token': token, 'x-webvue-tenant-revision': '1', cookie: 'session_id=signed-envelope' } })
  const event = { node: { req, res: new EventEmitter() } } as never
  try {
    for (const route of ['/api/v1/me', '/api/v1/branding', '/web/session/authenticate', '/api/v1/auth/totp', '/web/session/destroy']) {
      const response = await tenantTransport(event, base, route, { method: route.includes('session') || route.includes('totp') ? 'POST' : 'GET', body: route.includes('session') || route.includes('totp') ? '{}' : undefined })
      expect(response.status).toBe(200)
      expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([0, 1, 255, 128]))
      expect(response.headers.getSetCookie()).toHaveLength(2)
    }
    expect(destroyed).toBe(true)
    expect((await tenantTransport(event, base, '/api/v1/me', { method: 'HEAD' })).body).toBeNull()
    expect((await tenantTransport(event, base, '/api/v1/missing')).status).toBe(404)
    await expect(tenantTransport(event, base, '/api/v1/redirect')).rejects.toThrow('tenant_upstream_unavailable')
    for (const headers of calls) {
      expect(headers.host).toBe('a.example.test'); expect(headers['x-webvue-proxy-token']).toBe(token); expect(headers['x-webvue-tenant-revision']).toBe('1')
    }
    const pending = tenantTransport(event, base, '/api/v1/abort')
    const rejected = expect(pending).rejects.toThrow('tenant_upstream_unavailable')
    await abortRequest
    req.emit('aborted')
    await rejected
    await abortClose
    expect(req.listenerCount('aborted')).toBe(0)
    // Another completed request after cancellation is unaffected.
    expect((await tenantTransport(event, base, '/api/v1/me')).status).toBe(200)
    const count = calls.length
    for (const route of ['https://forbidden.invalid/api/v1/me', '//forbidden.invalid/api/v1/me', '/api/v1/../../web']) await expect(tenantTransport(event, base, route)).rejects.toThrow()
    req.headers.host = 'foreign.example.test'
    await expect(tenantTransport(event, base, '/api/v1/me')).rejects.toThrow('tenant_boundary_rejected')
    req.headers.host = 'a.example.test'; req.headers['x-webvue-proxy-token'] = ''
    await expect(tenantTransport(event, base, '/api/v1/me')).rejects.toThrow('tenant_boundary_rejected')
    expect(calls).toHaveLength(count)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); vi.unstubAllEnvs() }
})
