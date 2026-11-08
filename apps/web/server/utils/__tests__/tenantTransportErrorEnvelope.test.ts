import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { legacyTenantResponse, tenantTransport } from '../tenantTransport'

const token = 'synthetic-error-envelope-token'.repeat(2)
const ENGINE_ERROR = {
  name: 'psycopg2.errors.UniqueViolation',
  message: 'duplicate key value violates unique constraint "hr_employee_liwan_mobile_uniq"',
  arguments: ['hr.employee', 42],
  context: {},
  debug: 'Traceback (most recent call last):\n  File "/srv/odoo/odoo-addons/liwan_hr/serializers/employee.py", line 88, in dump_employee\n    payroll = employee.gross\nKeyError: gross',
}
let server: http.Server
let base = ''
let seen: string[] = []

function browserEvent() {
  const req = Object.assign(new EventEmitter(), { headers: { host: 'a.example.test', 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '1' } })
  const res = Object.assign(new EventEmitter(), { writableEnded: false })
  return { event: { node: { req, res } } as never }
}

beforeEach(async () => {
  seen = []
  const path = join(mkdtempSync(join(tmpdir(), 'liwan-envelope-')), 'registry.json')
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, snapshotRevision: 1, targets: [{ host: 'a.example.test', tenantId: 'a', database: 'db_a', filestore: 'db_a', registryRevision: 1, enabled: true }] }))
  vi.stubEnv('LIWAN_TENANCY_MODE', 'shared'); vi.stubEnv('LIWAN_SHARED_PROXY_TOKEN', token); vi.stubEnv('LIWAN_TENANT_REGISTRY_PATH', path)
  server = http.createServer((req, res) => {
    req.resume()
    seen.push(req.url ?? '')
    // A cancelled oversize read resets the receiving socket while this response is still writing.
    res.on('error', () => {})
    res.setHeader('content-type', 'application/json')
    // Odoo's own json2 body for an uncaught exception, exactly as serialize_exception builds it.
    if (req.url === '/api/v1/engine-500') { res.statusCode = 500; res.setHeader('x-synthetic', 'kept'); res.end(JSON.stringify(ENGINE_ERROR)); return }
    // A contract refusal keeps its own status and body.
    if (req.url === '/api/v1/contract-422') { res.statusCode = 422; res.end(JSON.stringify({ code: 'invalid', message: 'gross must be positive', field: 'gross' })); return }
    // An engine 4xx carries the same serialized shape (a werkzeug NotFound reaches json2's handle_error).
    if (req.url === '/api/v1/engine-404') { res.statusCode = 404; res.end(JSON.stringify({ name: 'werkzeug.exceptions.NotFound', message: 'no route', arguments: ['/api/v1/x'], context: {}, debug: 'Traceback' })); return }
    // A non-contract error body that exceeds the response cap: the bound applies before the
    // envelope check, exactly as it does to a success body, so it is refused and never buffered.
    if (req.url === '/api/v1/huge-engine-500') { res.statusCode = 500; res.end(Buffer.alloc(33 * 1024 * 1024, 65)); return }
    // A success body is never touched, even when it carries a key named like an engine field.
    if (req.url === '/api/v1/ok') { res.statusCode = 200; res.end(JSON.stringify({ debug: true, items: [], total: 0 })); return }
    // A non-JSON error body cannot carry the engine's serialized exception and passes unchanged.
    if (req.url === '/api/v1/plain-500') { res.statusCode = 500; res.setHeader('content-type', 'text/plain'); res.end('Internal Server Error'); return }
    if (req.url === '/api/v1/not-json-500') { res.statusCode = 500; res.setHeader('content-type', 'text/html'); res.end('<html>Server Error</html>'); return }
    if (req.url === '/web/session/authenticate') { res.statusCode = 404; res.end(JSON.stringify({ code: 'not_found', message: 'Record does not exist' })); return }
    res.statusCode = 404; res.end(JSON.stringify({ code: 'not_found', message: 'Record does not exist' }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
  vi.unstubAllEnvs()
})

describe('tenantTransport never relays the engine error shape', () => {
  it('replaces an engine 500 body with the generic refusal and keeps the status', async () => {
    const logged: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((message: string) => { logged.push(message) })
    try {
      const response = await tenantTransport(browserEvent().event, base, '/api/v1/engine-500')
      expect(response.status).toBe(500)
      const text = Buffer.from(await response.arrayBuffer()).toString()
      expect(JSON.parse(text)).toEqual({ code: 'internal', message: 'An unexpected error occurred' })
      // The refusal names no model, file, line, argument or traceback.
      expect(response.headers.get('x-synthetic')).toBe('kept')
      for (const leak of ['debug', 'arguments', 'Traceback', 'hr.employee', 'gross', 'liwan_hr']) expect(text).not.toContain(leak)
    } finally { spy.mockRestore() }
    // The server keeps the evidence: the status and the route, never the body Odoo wrote.
    expect(logged).toEqual(['[liwan-bff] non-contract upstream error body: 500 /api/v1/engine-500'])
  })

  it('keeps a body that already is the contract envelope, and every 4xx status', async () => {
    const refusal = await tenantTransport(browserEvent().event, base, '/api/v1/contract-422')
    expect(refusal.status).toBe(422)
    expect(await refusal.json()).toEqual({ code: 'invalid', message: 'gross must be positive', field: 'gross' })
    const missing = await tenantTransport(browserEvent().event, base, '/api/v1/absent')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ code: 'not_found', message: 'Record does not exist' })
  })

  it('replaces an engine 4xx body too: the serialized exception shape is not the envelope at any status', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const response = await tenantTransport(browserEvent().event, base, '/api/v1/engine-404')
      expect(response.status).toBe(404)
      const text = Buffer.from(await response.arrayBuffer()).toString()
      expect(JSON.parse(text)).toEqual({ code: 'not_found', message: 'An unexpected error occurred' })
      expect(text).not.toContain('werkzeug')
      expect(text).not.toContain('Traceback')
    } finally { spy.mockRestore() }
  })

  it('never rewrites a success body', async () => {
    const response = await tenantTransport(browserEvent().event, base, '/api/v1/ok')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ debug: true, items: [], total: 0 })
  })

  it('replaces a non-JSON error answer too: every /api/v1 error is the envelope', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const plain = await tenantTransport(browserEvent().event, base, '/api/v1/plain-500')
      expect(plain.status).toBe(500)
      expect(await plain.json()).toEqual({ code: 'internal', message: 'An unexpected error occurred' })
      const html = await tenantTransport(browserEvent().event, base, '/api/v1/not-json-500')
      expect(html.status).toBe(500)
      expect(await html.json()).toEqual({ code: 'internal', message: 'An unexpected error occurred' })
    } finally { spy.mockRestore() }
  })

  it('never touches an error answer outside /api/v1', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const response = await tenantTransport(browserEvent().event, base, '/web/session/authenticate', { method: 'POST', body: '{}' })
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ code: 'not_found', message: 'Record does not exist' })
    } finally { spy.mockRestore() }
  })

  it('keeps a HEAD answer bodiless', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const response = await tenantTransport(browserEvent().event, base, '/api/v1/engine-500', { method: 'HEAD' })
      expect([response.status, response.body]).toEqual([500, null])
    } finally { spy.mockRestore() }
  })

  it('refuses an oversize non-contract error body instead of buffering it', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      // The cap is applied while reading, before the envelope check, so the answer fails
      // exactly as an oversize success body does and is never materialized whole.
      await expect(tenantTransport(browserEvent().event, base, '/api/v1/huge-engine-500'))
        .rejects.toThrow('tenant_upstream_unavailable')
    } finally { spy.mockRestore() }
  }, 30_000)
})

describe('the legacy dedicated transport applies the same envelope rule', () => {
  beforeEach(() => { vi.stubEnv('LIWAN_TENANCY_MODE', 'dedicated') })

  it('replaces the engine body and keeps a contract refusal', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const engine = await legacyTenantResponse(browserEvent().event, base, '/api/v1/engine-500', { headers: {} })
      expect(engine.status).toBe(500)
      const text = Buffer.from(await engine.arrayBuffer()).toString()
      expect(JSON.parse(text)).toEqual({ code: 'internal', message: 'An unexpected error occurred' })
      expect(text).not.toContain('Traceback')
      const contract = await legacyTenantResponse(browserEvent().event, base, '/api/v1/contract-422', { headers: {} })
      expect(contract.status).toBe(422)
      expect(await contract.json()).toEqual({ code: 'invalid', message: 'gross must be positive', field: 'gross' })
    } finally { spy.mockRestore() }
  })

  it('refuses an oversize non-contract error body instead of buffering it', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      // Dedicated mode reads the error body through the same bound as a success body,
      // so an over-cap answer fails before any envelope check can replace it.
      await expect(legacyTenantResponse(browserEvent().event, base, '/api/v1/huge-engine-500', { headers: {} }))
        .rejects.toThrow('tenant_upstream_unavailable')
    } finally { spy.mockRestore() }
  }, 30_000)
})
