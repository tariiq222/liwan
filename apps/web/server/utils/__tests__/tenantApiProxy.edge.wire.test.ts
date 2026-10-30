import http from 'node:http'
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { ApiErrorSchema } from '../../../../../packages/contracts/src/common/error'

const token = 'synthetic-edge-admission-token-'.repeat(3)
const keys = { test: 'synthetic-edge-cookie-key-'.repeat(3) }
const tenant = { tenantId: 'tenant_a', host: 'tenant.example.test', database: 'db_a', filestore: 'db_a', registryRevision: 1, enabled: true }
const route = { schemaVersion: 1, tenantId: tenant.tenantId, identityRevision: 1, routeRevision: 1, releaseId: 'r1', poolId: 'blue', fence: 1, state: 'serving' }
const listen = (server: http.Server) => new Promise<string>(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`)))
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules() })

async function fixture(mode: 'shared' | 'dedicated') {
  vi.resetModules()
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'liwan-api-edge-')))
  const registryPath = join(root, 'registry.json')
  writeFileSync(registryPath, JSON.stringify({ schemaVersion: 1, snapshotRevision: 1, targets: [tenant] }))
  writeFileSync(join(root, 'binding.json'), JSON.stringify({ tenantId: tenant.tenantId, database: tenant.database, filestore: tenant.filestore, identityRevision: 1, host: tenant.host, commercialMode: 'non_saas' }))
  writeFileSync(join(root, 'tenant_a.json'), JSON.stringify(route))
  vi.stubEnv('LIWAN_TENANCY_MODE', mode)
  vi.stubEnv('LIWAN_SHARED_PROXY_TOKEN', token)
  vi.stubEnv('LIWAN_TENANT_REGISTRY_PATH', registryPath)
  vi.stubEnv('LIWAN_RELEASE_ROUTES_DIR', root)
  vi.stubEnv('LIWAN_RELEASE_TENANT_ID', tenant.tenantId)
  vi.stubEnv('LIWAN_RELEASE_TENANT_HOST', tenant.host)
  vi.stubEnv('LIWAN_RELEASE_IDENTITY_REVISION', '1')
  vi.stubEnv('LIWAN_DEDICATED_PROXY_TOKEN', token)
  vi.stubEnv('LIWAN_RELEASE_POOL_ID', 'blue')
  const shared = await import('../../../../../deploy/shared/guard.mjs')
  const dedicated = await import('../../../../../deploy/releases/dedicated_guard.mjs')
  const codec = shared.sessionCodec(keys, 'test')
  const observed: Array<{ path: string; headers: http.IncomingHttpHeaders; body: Buffer }> = []
  const webHops: Array<{ path: string; headers: http.IncomingHttpHeaders; request: http.IncomingMessage }> = []
  const held: Array<() => void> = []
  const waiting: Array<() => void> = []
  let hold = false
  let active = 0
  let maxActive = 0
  const sockets = new Set<import('node:net').Socket>()
  const track = (server: http.Server) => server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  const odoo = track(http.createServer((req, res) => {
    const serve = () => {
      active++; maxActive = Math.max(maxActive, active)
      let released = false
      const release = () => { if (!released) { released = true; active--; waiting.shift()?.() } }
      res.once('finish', release); res.once('close', release)
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        observed.push({ path: req.url!, headers: req.headers, body: Buffer.concat(chunks) })
        const reply = () => {
          if (res.writableEnded || res.destroyed) return
          res.setHeader('content-type', 'application/json')
          if (req.url === '/api/v1/me') {
            if (req.headers.cookie !== 'session_id=verified') { res.statusCode = 403; res.end('{}'); return }
            res.end(JSON.stringify({ id: 7, company: { id: 1 } })); return
          }
          if (req.url === '/api/v1/echo') { res.statusCode = 201; res.setHeader('set-cookie', ['session_id=verified; Path=/; HttpOnly']); res.setHeader('etag', '"edge-bytes"'); res.end(JSON.stringify({ hex: Buffer.concat(chunks).toString('hex') })); return }
          res.end(JSON.stringify({ ok: true }))
        }
        if (hold && req.url === '/api/v1/me' && req.headers.cookie !== 'session_id=verified') held.push(reply); else reply()
      })
    }
    // Exactly two HTTP workers; a held reply cannot be served concurrently by a third.
    if (active < 2) serve(); else waiting.push(serve)
  }))
  const odooUrl = await listen(odoo)
  let guardUrl = ''
  vi.stubGlobal('defineEventHandler', defineEventHandler)
  vi.stubGlobal('useRuntimeConfig', () => ({ odooUrl: guardUrl, authProxyClientIpHeader: '' }))
  const boundary = (await import('../../middleware/tenant-boundary')).default
  const api = (await import('../../routes/api/v1/[...path]')).default
  const app = createApp()
  app.use(boundary)
  app.use(api)
  const listener = toNodeListener(app)
  const web = track(http.createServer((req, res) => { webHops.push({ path: req.url!, headers: req.headers, request: req }); listener(req, res) }))
  const webUrl = await listen(web)
  writeFileSync(join(root, 'pools.json'), JSON.stringify({ schemaVersion: 1, pools: { blue: { poolId: 'blue', releaseId: 'r1', odooUrl, webUrl, wsUrl: odooUrl } } }))
  const guard = track(mode === 'shared'
    ? shared.createGuard({ registryPath, proxyToken: token, keys, activeKid: 'test', odooUrl, webUrl, releaseRoutesDir: root, releaseAssetsDir: undefined })
    : dedicated.createDedicatedGuard({ bindingPath: join(root, 'binding.json'), releaseRoutesDir: root, proxyToken: token, releaseAssetsDir: undefined }))
  guardUrl = await listen(guard)
  const issuedCookies = new Map<string, string>()
  const cookie = (sid: string) => {
    if (!issuedCookies.has(sid)) issuedCookies.set(sid, `session_id=${mode === 'shared' ? codec.seal(sid, tenant) : sid}`)
    return issuedCookies.get(sid)!
  }
  function call(path: string, sid?: string, body?: Buffer, extra: Record<string, string> = {}) {
    return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      const request = http.request(new URL(path, guardUrl), { method: body ? 'POST' : 'GET', headers: { host: tenant.host, ...(sid ? { cookie: cookie(sid) } : {}), ...extra } }, response => {
        const chunks: Buffer[] = []
        response.on('data', chunk => chunks.push(Buffer.from(chunk)))
        response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks) }))
      })
      request.on('error', reject); request.setTimeout(1000, () => request.destroy(Error('edge_request_timeout'))); request.end(body)
    })
  }
  return {
    root, guardUrl, cookie, codec, call, observed, webHops, held,
    get active() { return active }, get maxActive() { return maxActive }, get waiting() { return waiting.length },
    holdChecks() { hold = true },
    async close() {
      hold = false
      for (const release of held) release()
      for (const socket of sockets) socket.destroy()
      await Promise.all([guard, web, odoo].map(server => new Promise<void>(resolve => server.close(() => resolve()))))
      await vi.waitFor(() => {
        const leases = join(root, 'leases', tenant.tenantId)
        expect(existsSync(leases) ? readdirSync(leases) : []).toHaveLength(0)
      })
      rmSync(root, { recursive: true })
    },
  }
}

it.each(['shared', 'dedicated'] as const)('%s public API reaches actual Nuxt admission and internal forwarding never loops', async mode => {
  const wire = await fixture(mode)
  try {
    const missing = await wire.call('/api/v1/tasks')
    expect(missing.status).toBe(401)
    expect(ApiErrorSchema.parse(JSON.parse(missing.body.toString()).data).code).toBe('session_required')
    expect(wire.observed).toHaveLength(0)
    expect(wire.webHops).toHaveLength(1)
    expect((await wire.call('/api/v1/tasks', 'verified')).status).toBe(200)
    expect(wire.observed.map(item => item.path)).toEqual(['/api/v1/me', '/api/v1/tasks'])
    expect(wire.webHops).toHaveLength(2)
    for (const item of wire.observed) {
      expect(item.headers.cookie).toBe('session_id=verified')
      expect(item.headers.host).toBe(mode === 'shared' ? tenant.database : tenant.host)
      for (const name of ['x-liwan-proxy-token', 'x-liwan-tenant-revision', 'x-liwan-release-pool', 'x-liwan-release-admission']) expect(item.headers[name]).toBeUndefined()
    }
    const hop = wire.webHops[1]!.headers
    expect(hop.host).toBe(tenant.host)
    expect(hop.cookie).toBe(wire.cookie('verified'))
    expect(hop['x-liwan-release-pool']).toBe('blue')
    expect(hop['x-liwan-release-admission']).toMatch(/^[a-f0-9-]{36}$/)
    const bytes = Buffer.from([0, 255, 128, 42])
    if (mode === 'dedicated') {
      const binary = await wire.call('/api/v1/echo', 'verified', bytes, { 'content-type': 'application/octet-stream' })
      expect(binary.status).toBe(201)
      expect(JSON.parse(binary.body.toString())).toEqual({ hex: bytes.toString('hex') })
    }
    const jsonBytes = Buffer.from('{"name":"عربي"}')
    const result = await wire.call('/api/v1/echo', 'verified', jsonBytes, { 'content-type': 'application/json' })
    expect(result.status).toBe(201)
    expect(JSON.parse(result.body.toString())).toEqual({ hex: jsonBytes.toString('hex') })
    expect(result.headers.etag).toBe('"edge-bytes"')
    const issued = result.headers['set-cookie']![0]!.split(';')[0]!.slice(11)
    expect(mode === 'shared' ? wire.codec.open(issued, tenant) : issued).toBe('verified')
    expect((await wire.call('/api/v1/branding')).status).toBe(200)
    expect((await wire.call('/api/v1/auth/totp', undefined, Buffer.from('{"code":"123456"}'), { 'content-type': 'application/json' })).status).toBe(200)
  } finally { await wire.close() }
})

it.each(['shared', 'dedicated'] as const)('%s keeps nested API static paths behind Nuxt admission', async mode => {
  const wire = await fixture(mode)
  try {
    const response = await wire.call('/api/v1/attachments/static/probe')
    expect(response.status).toBe(401)
    expect(wire.observed).toHaveLength(0)
    expect(wire.webHops).toHaveLength(1)
  } finally { await wire.close() }
})

it.each(['shared', 'dedicated'] as const)('%s rejects a forged slow API upload before reading its body', async mode => {
  const wire = await fixture(mode)
  let upload: http.ClientRequest | undefined
  try {
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      upload = http.request(new URL('/api/v1/tasks', wire.guardUrl), { method: 'POST', headers: { host: tenant.host, cookie: wire.cookie('forged'), 'content-type': 'application/json', 'content-length': '100000' } }, reply => {
        let body = ''; reply.on('data', chunk => { body += chunk }); reply.on('end', () => resolve({ status: reply.statusCode!, body }))
      })
      upload.on('error', reject)
      upload.setTimeout(700, () => upload!.destroy(Error('waited_for_forged_body')))
      upload.write('{')
    })
    expect(response.status).toBe(401)
    expect(ApiErrorSchema.parse(JSON.parse(response.body).data).code).toBe('session_required')
    expect(wire.observed.map(item => item.path)).toEqual(['/api/v1/me'])
    expect(wire.webHops).toHaveLength(1)
    expect(wire.webHops[0]!.request.complete).toBe(false)
    await vi.waitFor(() => expect(wire.webHops[0]!.request.socket.destroyed).toBe(true), { timeout: 500 })
  } finally { upload?.destroy(); await wire.close() }
})

it.each(['shared', 'dedicated'] as const)('%s edge keeps verified work on the second worker while queueing another cold identity', async mode => {
  const wire = await fixture(mode)
  const pending: Array<Promise<unknown>> = []
  try {
    expect((await wire.call('/api/v1/tasks', 'verified')).status).toBe(200)
    wire.holdChecks()
    const first = wire.call('/api/v1/tasks', 'forged-a'); pending.push(first)
    await vi.waitFor(() => expect(wire.held).toHaveLength(1))
    // The excess cold identity waits in the bounded lane queue; it never takes a second worker.
    const second = wire.call('/api/v1/tasks', 'forged-b'); pending.push(second)
    expect((await wire.call('/api/v1/tasks', 'verified')).status).toBe(200)
    expect(wire.observed.map(item => item.path)).toEqual(['/api/v1/me', '/api/v1/tasks', '/api/v1/me', '/api/v1/tasks'])
    expect(wire.active).toBe(1)
    expect(wire.maxActive).toBe(2)
    expect(wire.waiting).toBe(0)
    wire.held[0]!()
    expect((await first).status).toBe(401)
    await vi.waitFor(() => expect(wire.held).toHaveLength(2))
    wire.held[1]!()
    expect((await second).status).toBe(401)
  } finally { await wire.close(); await Promise.allSettled(pending) }
})

// This parses the deployed Caddy routing clauses, rather than a copied path table.
// The accepted grammar is deliberately narrow; routing syntax changes require a new oracle.
it('the actual direct Caddy routing sends API to web and preserves legacy Odoo/WS destinations', () => {
  const config = readFileSync(new URL('../../../../../deploy/Caddyfile', import.meta.url), 'utf8').replace(/#.*$/gm, '')
  const named = new Map([...config.matchAll(/^\s*(@\w+)\s+path\s+([^\n]+)/gm)].map(match => [match[1]!, match[2]!.trim().split(/\s+/)]))
  const routes: Array<{ matcher?: string; target: string }> = []
  for (const match of config.matchAll(/\bhandle(?:\s+([^\s{]+))?\s*\{/g)) {
    let depth = 1, end = match.index! + match[0].length
    for (; end < config.length && depth; end++) { if (config[end] === '{') depth++; if (config[end] === '}') depth-- }
    expect(depth).toBe(0)
    const target = config.slice(match.index! + match[0].length, end).match(/reverse_proxy\s+([^\s{]+)/)?.[1]
    expect(target).toBeDefined()
    routes.push({ matcher: match[1], target: target! })
  }
  const destination = (path: string) => routes.find(route => {
    const patterns = route.matcher?.startsWith('@') ? named.get(route.matcher) : route.matcher ? [route.matcher] : ['*']
    expect(patterns).toBeDefined()
    return patterns!.some(pattern => pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern)
  })?.target
  for (const path of ['/api/v1/tasks', '/api/v1/branding', '/api/v1/auth/totp', '/api/auth/login', '/login']) expect(destination(path)).toBe('web:3000')
  for (const path of ['/web/health', '/report/barcode']) expect(destination(path)).toBe('odoo:8069')
  expect(destination('/websocket')).toBe('odoo:8072')
})
