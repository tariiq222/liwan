import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tenantTransport } from '../tenantTransport'

const token = 'synthetic-shield-token'.repeat(3)
let server: http.Server
let base = ''

function browserEvent() {
  const req = Object.assign(new EventEmitter(), { headers: { host: 'a.example.test', 'x-nasq-proxy-token': token, 'x-nasq-tenant-revision': '1' } })
  const res = Object.assign(new EventEmitter(), { writableEnded: false })
  return { event: { node: { req, res } } as never, res }
}

beforeEach(async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'nasq-shield-')), 'registry.json')
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, snapshotRevision: 1, targets: [{ host: 'a.example.test', tenantId: 'a', database: 'db_a', filestore: 'db_a', registryRevision: 1, enabled: true }] }))
  vi.stubEnv('NASQ_TENANCY_MODE', 'shared'); vi.stubEnv('NASQ_SHARED_PROXY_TOKEN', token); vi.stubEnv('NASQ_TENANT_REGISTRY_PATH', path)
  server = http.createServer((req, res) => {
    req.resume()
    setTimeout(() => { res.setHeader('content-type', 'application/json'); res.end('{"ok":true}') }, 120)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
  vi.unstubAllEnvs()
})

describe('tenantTransport browser disconnect', () => {
  it('aborts the upstream call by default when the browser goes away', async () => {
    const { event, res } = browserEvent()
    const pending = tenantTransport(event, base, '/api/v1/me')
    const rejected = expect(pending).rejects.toThrow('tenant_upstream_unavailable')
    setTimeout(() => res.emit('close'), 20)
    await rejected
  })

  it('lets a shielded call (ignoreClientClose) finish after the browser went away', async () => {
    const { event, res } = browserEvent()
    const pending = tenantTransport(event, base, '/api/v1/me', { ignoreClientClose: true })
    setTimeout(() => res.emit('close'), 20)
    const response = await pending
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('still honours an explicit signal on a shielded call', async () => {
    const { event } = browserEvent()
    const controller = new AbortController()
    const pending = tenantTransport(event, base, '/api/v1/me', { ignoreClientClose: true, signal: controller.signal })
    const rejected = expect(pending).rejects.toThrow('tenant_upstream_unavailable')
    setTimeout(() => controller.abort(), 20)
    await rejected
  })
})
