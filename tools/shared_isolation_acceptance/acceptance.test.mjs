import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { writeFileSync, readFileSync } from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { createGuard, sessionCodec, requestPlan } from '../../deploy/shared/guard.mjs'
import { validateRegistry, readTenantRegistry } from '../../apps/web/server/utils/tenantRegistry.ts'
import { reconcileSharedJob, bindJob } from '../../apps/control-plane/src/shared/provisioning.ts'

const targets = Array.from({ length: 10 }, (_, i) => ({ host: `tenant${i}.acceptance.test`, tenantId: `tenant${i}`, database: `acceptance_${i}`, filestore: `acceptance_${i}`, enabled: true, registryRevision: 1 }))
const snapshot = () => ({ schemaVersion: 1, snapshotRevision: 1, targets: structuredClone(targets) })
const token = 'synthetic-proxy-token-not-secret-123456789'
const keys = { test: 'synthetic-signing-key-not-secret-123456789' }
const codec = sessionCodec(keys, 'test')
const binding = ({ host, enabled, ...value }) => value
const job = t => ({ schemaVersion: 1, operation: 'backup', requestId: 'c9e0ac18-0869-4e28-8b69-231d7a4bd982', binding: binding(t) })
const cookie = t => `session_id=${codec.seal(`sid_${t.tenantId}`, t)}`
const req = (t, path, extra = {}) => ({ url: path, headers: { host: t.host, cookie: cookie(t), ...extra } })

test('pure jobs: 10 positive controls, 90 foreign bindings, stale and disabled jobs', () => {
  let positives = 0, pairs = 0
  for (const a of targets) {
    assert.equal(reconcileSharedJob(job(a), { ...binding(a), enabled: true }, null, { state: 'absent' }).action, 'persist_intent'); positives++
    assert.throws(() => reconcileSharedJob(job(a), { ...binding(a), registryRevision: 2, enabled: true }, null, { state: 'absent' }))
    assert.throws(() => reconcileSharedJob(job(a), { ...binding(a), enabled: false }, null, { state: 'absent' }))
    for (const b of targets.filter(t => t !== a)) {
      assert.throws(() => reconcileSharedJob(job(a), { ...binding(b), enabled: true }, null, { state: 'absent' }))
      assert.throws(() => bindJob({ ...job(a), operation: 'restore', approvalId: job(a).requestId, backup: { schemaVersion: 1, backupId: job(a).requestId, binding: binding(b), databaseSha256: 'a'.repeat(64), filestoreSha256: 'b'.repeat(64), consistency: 'verified' } })); pairs++
    }
  }
  assert.deepEqual([positives, pairs], [10, 90])
})

test('pure registry, forged headers/selectors, session expiry/key rotation and route controls', () => {
  const r = snapshot(), a = targets[0]
  for (const field of ['host', 'tenantId', 'database', 'filestore']) {
    const bad = snapshot(); bad.targets[1][field] = bad.targets[0][field]; assert.throws(() => validateRegistry(bad))
  }
  for (const host of ['unknown.test', `${a.host}:443`, `${a.host}.`, `${a.host},evil.test`, 'acceptance_0']) assert.throws(() => requestPlan(req(a, '/api/v1/me', { host }), r, token, codec))
  for (const name of ['x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'x-odoo-database', 'x-openerp-session-id', 'x-webvue-tenant-revision']) assert.throws(() => requestPlan(req(a, '/api/v1/me', { [name]: 'forged' }), r, token, codec))
  for (const path of ['/api/v1/me?db=x', '/api/v1/me?%64atabase=x', '/web/database/list', '/jsonrpc', '/web/session/authenticate', '/report/pdf/x']) assert.throws(() => requestPlan(req(a, path), r, token, codec))
  for (const value of ['raw_sid', cookie(a).slice(11) + 'x']) assert.throws(() => requestPlan(req(a, '/api/v1/me', { cookie: `session_id=${value}` }), r, token, codec))
  assert.throws(() => requestPlan(req(a, '/api/v1/me', { cookie: `${cookie(a)}; ${cookie(a)}` }), r, token, codec))
  const signed = sessionCodec(keys, 'test', () => 1).seal('sid', a)
  assert.throws(() => sessionCodec(keys, 'test', () => 3601).open(signed, a))
  assert.throws(() => sessionCodec({ new: 'n'.repeat(40) }, 'new').open(cookie(a).slice(11), a))
  for (const path of ['/api/v1/branding', '/api/v1/reports/projects/summary', '/api/v1/auth/totp']) {
    assert.equal(requestPlan(req(a, path), r, token, codec).odoo, false, 'external API goes through Nuxt')
    assert.equal(requestPlan(req(a, path, { 'x-webvue-proxy-token': token, 'x-webvue-tenant-revision': '1' }), r, token, codec).odoo, true, 'internal API reaches Odoo')
  }
})

test('configuration replay: dedicated proxies remain frozen when runtime env changes (finding)', () => {
  const source = readFileSync(new URL('../../apps/web/nuxt.config.ts', import.meta.url), 'utf8').replace(/^import .*$/gm, '').replaceAll('import.meta.url', JSON.stringify(new URL('../../apps/web/nuxt.config.ts', import.meta.url).href)).replace('export default defineNuxtConfig(', 'globalThis.result = defineNuxtConfig(')
  const configHelpers = { URL, fileURLToPath, discoverLocaleFiles: () => ({ ar: [], en: [] }) }
  const context = { ...configHelpers, process: { env: { WEBVUE_TENANCY_MODE: 'dedicated', NUXT_ODOO_URL: 'http://synthetic-odoo:8069' } }, defineNuxtConfig: x => x }
  vm.runInNewContext(source, context)
  context.process.env.WEBVUE_TENANCY_MODE = 'shared'
  assert.equal(context.result.routeRules['/web/**'].proxy.to, 'http://synthetic-odoo:8069/web/**')
  const shared = { ...configHelpers, process: { env: { WEBVUE_TENANCY_MODE: 'shared' } }, defineNuxtConfig: x => x }
  vm.runInNewContext(source, shared); assert.deepEqual(Object.entries(shared.result.routeRules).filter(([, rule]) => rule.proxy), [])
})

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)))
const call = (base, t, path, method = 'GET', body, extra = {}) => new Promise((resolve, reject) => {
  const q = http.request(`${base}${path}`, { method, headers: { host: t.host, cookie: cookie(t), ...(body ? { 'content-type': 'application/json' } : {}), ...extra }, timeout: 3000 }, r => { let text = ''; r.on('data', c => text += c); r.on('end', () => resolve({ status: r.statusCode, text, headers: r.headers })) })
  q.on('error', reject); q.on('timeout', () => q.destroy(Error('timeout'))); q.end(body)
})
const ws = (base, t, extra = {}) => new Promise((resolve, reject) => {
  const socket = net.connect(Number(new URL(base).port), '127.0.0.1'); let data = ''
  socket.setTimeout(3000, () => socket.destroy(Error('timeout'))); socket.on('error', reject)
  socket.on('connect', () => socket.write(`GET /websocket HTTP/1.1\r\nHost: ${t.host}\r\nCookie: ${extra.cookie ?? cookie(t)}\r\n${extra.originLines ?? `Origin: https://${t.host}\r\n`}Connection: Upgrade\r\nUpgrade: websocket\r\n\r\n`))
  socket.on('data', chunk => { data += chunk; if (data.includes('\r\n\r\n')) { socket.destroy(); resolve(data) } })
})

test('HTTP/WS mock matrix: each surface has 10 positives and 90 rejected foreign sessions; no real Odoo', { timeout: 45000 }, async () => {
  const start = Date.now(), sockets = new Set(), counts = {}
  const registryPath = new URL('./synthetic-registry.json', import.meta.url).pathname
  writeFileSync(registryPath, JSON.stringify(snapshot()))
  let upstreamHits = 0
  const backend = http.createServer(async (q, s) => {
    upstreamHits++; let body = ''; for await (const c of q) body += c
    // Synthetic DB-partition ownership oracle, NOT Odoo ACL/ORM behavior.
    if (q.url.startsWith('/api/v1/foreign/')) {
      const owner = q.url.split('/').at(-1)
      s.statusCode = q.headers.host === owner ? 200 : 404
    }
    s.setHeader('content-type', 'application/json'); s.end(JSON.stringify({ host: q.headers.host, cookie: q.headers.cookie, body, path: q.url }))
  })
  backend.on('upgrade', (q, socket) => { upstreamHits++; socket.write(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nX-Mock-Host: ${q.headers.host}\r\n\r\n`) })
  let guardOrigin
  // This matrix covers guard tenant isolation, not Nuxt authentication. Model
  // its internal return hop; actual Nuxt admission has separate edge-wire tests.
  const web = http.createServer((q, s) => {
    const upstream = http.request(new URL(q.url, guardOrigin), { method: q.method, headers: q.headers }, reply => {
      s.writeHead(reply.statusCode, reply.headers); reply.pipe(s)
    })
    upstream.on('error', () => { if (!s.headersSent) s.writeHead(502); s.end() })
    q.pipe(upstream)
  })
  let guard
  const track = s => s.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  track(backend); track(web)
  try {
    const upstream = await listen(backend), webUrl = await listen(web)
    guard = createGuard({ registryPath, proxyToken: token, keys, activeKid: 'test', odooUrl: upstream, webUrl, wsUrl: upstream }); track(guard)
    const base = await listen(guard); guardOrigin = base
    console.log(JSON.stringify({ evidence: 'loopback mock only', upstream, webUrl, guard: base }))
    for (const [surface, path, method, body] of [['read', '/api/v1/tasks/1', 'GET'], ['write', '/api/v1/tasks/1', 'PATCH', '{"name":"synthetic"}'], ['files', '/api/v1/tasks/1/attachments/1/download', 'GET'], ['session', '/api/v1/me', 'GET']]) {
      counts[surface] = { positive: 0, foreign: 0 }
      for (const a of targets) {
        const own = await call(base, a, path, method, body); assert.equal(own.status, 200)
        assert.equal(JSON.parse(own.text).host, a.database); assert.equal(JSON.parse(own.text).cookie, `session_id=sid_${a.tenantId}`); counts[surface].positive++
        for (const b of targets.filter(t => t !== a)) { const before = upstreamHits; assert.equal((await call(base, b, path, method, body, { cookie: cookie(a) })).status, 403); assert.equal(upstreamHits, before); counts[surface].foreign++ }
      }
    }
    counts.ws = { positive: 0, foreign: 0 }
    for (const a of targets) {
      const own = await ws(base, a); assert.match(own, /^HTTP\/1.1 101/); assert.ok(own.toLowerCase().includes(`x-mock-host: ${a.database}`)); counts.ws.positive++
      for (const b of targets.filter(t => t !== a)) { const before = upstreamHits; assert.match(await ws(base, b, { cookie: cookie(a) }), /^HTTP\/1.1 403/); assert.equal(upstreamHits, before); counts.ws.foreign++ }
    }
    for (const originLines of ['', 'Origin: null\r\n', 'Origin: https://evil.test\r\n', `Origin: https://${targets[1].host}\r\n`, `Origin: https://${targets[0].host}\r\nOrigin: https://${targets[0].host}\r\n`, `Origin: http://${targets[0].host}\r\n`]) {
      const before = upstreamHits
      assert.match(await ws(base, targets[0], { originLines }), /^HTTP\/1.1 403/)
      assert.equal(upstreamHits, before)
    }
    for (const selector of ['db', 'database', 'sid', 'session_id']) assert.equal((await call(base, targets[0], '/api/v1/tasks/1', 'PATCH', JSON.stringify({ nested: { [selector]: targets[1].database } }))).status, 400)
    const internal = { 'x-webvue-proxy-token': token, 'x-webvue-tenant-revision': '1' }
    assert.equal((await call(base, targets[0], '/web/session/authenticate', 'POST', JSON.stringify({ params: { db: targets[0].database } }), internal)).status, 200)
    assert.equal((await call(base, targets[0], '/web/session/authenticate', 'POST', JSON.stringify({ params: { db: targets[1].database } }), internal)).status, 400)
    assert.equal((await call(base, targets[0], '/web/session/destroy', 'POST', '{}', internal)).status, 200)
    assert.equal((await call(base, targets[0], '/api/v1/auth/totp', 'POST', '{"code":"123456"}')).status, 200)
    const revoked = snapshot(); revoked.targets[0].enabled = false; writeFileSync(registryPath, JSON.stringify(revoked))
    assert.equal((await call(base, targets[0], '/api/v1/me')).status, 403); assert.match(await ws(base, targets[0]), /^HTTP\/1.1 403/)
    assert.equal((await call(base, targets[1], '/api/v1/me')).status, 200)
    const revised = snapshot(); revised.targets[0].registryRevision = 2; writeFileSync(registryPath, JSON.stringify(revised))
    assert.equal((await call(base, targets[0], '/api/v1/me')).status, 403)
    // Re-read simulates fresh reader state, not a process restart.
    assert.equal(readTenantRegistry(registryPath).targets[0].registryRevision, 2)
    assert.equal((await call(base, revised.targets[0], '/api/v1/me')).status, 200)
    writeFileSync(registryPath, JSON.stringify(snapshot()))
    counts.resourceIdMock = { positive: 0, foreign: 0 }
    for (const a of targets) {
      assert.equal((await call(base, a, `/api/v1/foreign/${a.database}`)).status, 200); counts.resourceIdMock.positive++
      for (const b of targets.filter(t => t !== a)) {
        const foreign = await call(base, a, `/api/v1/foreign/${b.database}`)
        assert.equal(foreign.status, 404); assert.equal(JSON.parse(foreign.text).host, a.database); counts.resourceIdMock.foreign++
      }
    }
    // Actual open mock upgraded connection must close within bounded revocation window.
    const connected = Date.now()
    const live = net.connect(Number(new URL(base).port), '127.0.0.1')
    await new Promise((resolve, reject) => {
      live.on('error', reject); live.setTimeout(35000, () => live.destroy(Error('WS revocation timeout')))
      live.on('connect', () => live.write(`GET /websocket HTTP/1.1\r\nHost: ${targets[0].host}\r\nCookie: ${cookie(targets[0])}\r\nOrigin: https://${targets[0].host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`))
      live.once('data', data => { assert.match(data.toString(), /^HTTP\/1.1 101/); writeFileSync(registryPath, JSON.stringify(revoked)) })
      live.once('close', resolve)
    })
    assert.ok(Date.now() - connected >= 29000); assert.ok(Date.now() - connected < 35000)
    console.log(JSON.stringify({ wsForcedCloseMs: Date.now() - connected }))
    // Recreate guard on the same registry snapshot: revoked tenant remains denied.
    await new Promise(resolve => guard.close(resolve))
    guard = createGuard({ registryPath, proxyToken: token, keys, activeKid: 'test', odooUrl: upstream, webUrl, wsUrl: upstream }); track(guard)
    const restarted = await listen(guard); guardOrigin = restarted
    assert.equal((await call(restarted, targets[0], '/api/v1/me')).status, 403)
    assert.equal((await call(restarted, targets[1], '/api/v1/me')).status, 200)
    console.log(JSON.stringify({ restarted, restart: 'new guard instance, same process and registry; not OS/container restart' }))
    writeFileSync(registryPath, JSON.stringify(snapshot()))
    for (const value of Object.values(counts)) assert.deepEqual(value, { positive: 10, foreign: 90 })
    console.log(JSON.stringify({ counts, durationMs: Date.now() - start, realOdoo: false }))
  } finally {
    for (const socket of sockets) socket.destroy()
    await Promise.all([guard, backend, web].filter(Boolean).map(s => new Promise(resolve => s.close(resolve))))
    console.log(JSON.stringify({ cleanup: 'all three mock servers closed; sockets destroyed', durationMs: Date.now() - start }))
  }
})
