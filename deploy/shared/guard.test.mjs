import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionCodec, requestPlan, createGuard } from './guard.mjs'
import { validateRegistry, mutateRegistry } from '../../apps/web/server/utils/tenantRegistry.ts'
const targets = Array.from({ length: 10 }, (_, i) => ({ host: `t${i}.example.test`, tenantId: `tenant_${i}`, database: `db_${i}`, filestore: `db_${i}`, enabled: true, registryRevision: 1 }))
const registry = { schemaVersion: 1, snapshotRevision: 1, targets }
const token = 'test-only-proxy-token-'.repeat(3)
const keys = { test: 'test-only-signing-key-'.repeat(3) }
const codec = sessionCodec(keys, 'test')
const req = (i = 0, headers = {}, url = '/api/v1/me') => ({ headers: { host: targets[i].host, ...headers }, url })
test('10 tenants positive plus 90 foreign session pairs reject before dispatch', () => {
  for (let i = 0; i < 10; i++) {
    const cookie = `session_id=${codec.seal(`sid_${i}`, targets[i])}`
    assert.equal(requestPlan(req(i, { cookie }), registry, token, codec).headers.cookie, `session_id=sid_${i}`)
    for (let j = 0; j < 10; j++) if (i !== j) assert.throws(() => requestPlan(req(j, { cookie }), registry, token, codec))
  }
})
test('raw/tampered/expired/revoked sessions, selectors, header and route bypass deny', () => {
  const signed = codec.seal('sid_a', targets[0])
  for (const cookie of ['session_id=raw', `session_id=${signed}x`, `session_id=${signed}; session_id=${signed}`]) assert.throws(() => requestPlan(req(0, { cookie }), registry, token, codec))
  for (const header of ['x-odoo-database', 'x-openerp-session-id', 'x-forwarded-host', 'forwarded', 'x-webvue-proxy-token']) assert.throws(() => requestPlan(req(0, { [header]: 'forged' }), registry, token, codec))
  for (const path of ['/web/database/list', '/web/session/authenticate', '/jsonrpc', '/xmlrpc/2/object', '/api/v1/me?%64b=db_1', '/websocket?session_id=raw']) assert.throws(() => requestPlan(req(0, {}, path), registry, token, codec))
  assert.doesNotThrow(() => requestPlan(req(0, {}, '/report/barcode/?barcode_type=QR&value=x'), registry, token, codec))
  for (const path of ['/report/barcode/QR/x', '/report/pdf/x', '/report/barcode/x/']) assert.throws(() => requestPlan(req(0, {}, path), registry, token, codec))
  assert.throws(() => codec.open(signed, { ...targets[0], registryRevision: 2 }))
  const expired = sessionCodec(keys, 'test', () => 0).seal('sid_a', targets[0])
  assert.throws(() => codec.open(expired, targets[0]))
  const rotated = sessionCodec({ ...keys, next: 'next-test-key-'.repeat(4) }, 'next')
  assert.equal(rotated.open(signed, targets[0]), 'sid_a')
  assert.throws(() => sessionCodec({ next: 'next-test-key-'.repeat(4) }, 'next').open(signed, targets[0]))
})
test('registry revisions, authority, immutable binding and conflicts', () => {
  assert.equal(validateRegistry(registry).schemaVersion, 1)
  assert.throws(() => validateRegistry({ ...registry, targets: [{ ...targets[0], filestore: 'other' }] }))
  for (const field of ['host', 'database', 'filestore', 'tenantId']) assert.throws(() => validateRegistry({ ...registry, targets: [targets[0], { ...targets[1], [field]: targets[0][field] }] }))
  const update = { ...targets[0], enabled: false, registryRevision: 2 }
  assert.throws(() => mutateRegistry(registry, update, { actor: 'operator', canManageRegistry: false }, 1))
  assert.throws(() => mutateRegistry(registry, { ...update, database: 'other' }, { actor: 'operator', canManageRegistry: true }, 1))
  const changed = mutateRegistry(registry, update, { actor: 'operator', canManageRegistry: true }, 1)
  assert.equal(changed.audit.action, 'disable')
  assert.equal(changed.registry.targets.find(t => t.tenantId === 'tenant_1').registryRevision, 1)
  assert.throws(() => requestPlan(req(), changed.registry, token, codec))
})
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)))
const call = (url, path, headers, body) => new Promise((resolve, reject) => {
  const r = http.request(new URL(path, url), { method: body ? 'POST' : 'GET', headers }, res => { let text = ''; res.on('data', b => { text += b }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text })) }); r.setTimeout(2000, () => r.destroy(Error('test_timeout'))); r.on('error', reject); r.end(body)
})
test('actual HTTP guard login/MFA/content/BFF, cookie propagation and fresh disable (mock upstream only)', async t => {
  const root = mkdtempSync(join(tmpdir(), 'webvue-guard-test-'))
  const path = join(root, 'registry.json'); writeFileSync(path, JSON.stringify(registry))
  const calls = []
  const backend = http.createServer((req, res) => { calls.push({ url: req.url, headers: req.headers }); res.setHeader('set-cookie', ['session_id=odoo_sid; Path=/; HttpOnly']); if (req.url.startsWith('/web/image/')) res.setHeader('content-type', 'application/octet-stream'); res.end(req.url.startsWith('/web/image/') ? `MOCK_IMAGE_BYTES:${req.headers.host}:${req.url}` : 'ok') })
  backend.on('upgrade', (req, socket) => {
    calls.push({ url: req.url, headers: req.headers })
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
    socket.on('data', chunk => socket.write(chunk))
    socket.on('error', () => {})
  })
  const backendUrl = await listen(backend)
  const guard = createGuard({ registryPath: path, proxyToken: token, keys, activeKid: 'test', odooUrl: backendUrl, webUrl: backendUrl })
  const url = await listen(guard)
  t.after(() => { guard.closeAllConnections(); guard.close(); backend.closeAllConnections(); backend.close() })
  const trusted = { host: targets[0].host, 'x-webvue-proxy-token': token, 'x-webvue-tenant-revision': '1', 'content-type': 'application/json' }
  let result = await call(url, '/web/session/authenticate', trusted, JSON.stringify({ params: { db: 'db_0', login: 'user', password: 'not-secret-fixture' } }))
  assert.equal(result.status, 200); assert.equal(calls[0].headers.host, 'db_0')
  const cookie = result.headers['set-cookie'][0].split(';')[0]
  assert.match(result.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Lax/)
  assert.equal(codec.open(cookie.slice(11), targets[0]), 'odoo_sid')
  for (const route of ['/api/v1/auth/totp', '/web/content/1']) {
    result = await call(url, route, { host: targets[0].host, cookie })
    assert.equal(result.status, 200); assert.equal(calls.at(-1).headers.cookie, 'session_id=odoo_sid')
  }
  for (const image of ['/web/image/res.company/7/logo/32x32?v=0-abcdef123456', '/web/image/hr.employee/9/avatar_128']) {
    result = await call(url, image, { host: targets[0].host, cookie })
    assert.equal(result.status, 200)
    assert.equal(result.text, `MOCK_IMAGE_BYTES:db_0:${image}`)
    assert.equal(calls.at(-1).headers.cookie, 'session_id=odoo_sid')
    const count = calls.length
    result = await call(url, image, { host: targets[1].host, cookie })
    assert.equal(result.status, 403); assert.equal(calls.length, count)
    await new Promise((resolve, reject) => {
      const request = http.request(new URL(image, url), { method: 'HEAD', headers: { host: targets[0].host, cookie } }, response => {
        let body = ''; response.on('data', chunk => { body += chunk }); response.on('end', () => { assert.equal(response.statusCode, 200); assert.equal(response.headers['content-type'], 'application/octet-stream'); assert.equal(body, ''); resolve() })
      }); request.setTimeout(2000, () => request.destroy(Error('test_timeout'))); request.on('error', reject); request.end()
    })
  }
  await new Promise((resolve, reject) => {
    const ws = http.request(new URL('/websocket', url), { headers: { host: targets[0].host, cookie, origin: `https://${targets[0].host}`, connection: 'Upgrade', upgrade: 'websocket' } })
    ws.on('upgrade', (reply, socket) => {
      assert.equal(reply.statusCode, 101)
      assert.equal(calls.at(-1).headers.host, 'db_0')
      assert.equal(calls.at(-1).headers.cookie, 'session_id=odoo_sid')
      socket.write('ping')
      socket.once('data', chunk => { assert.equal(chunk.toString(), 'ping'); socket.destroy(); resolve() })
      socket.on('error', reject)
    })
    ws.on('error', reject); ws.end()
  })
  const before = calls.length
  result = await call(url, '/web/session/authenticate', trusted, JSON.stringify({ params: { db: 'db_1' } }))
  assert.equal(result.status, 400); assert.equal(calls.length, before)
  result = await call(url, '/api/auth/login', { host: targets[0].host, 'content-type': 'application/json' }, JSON.stringify({ db: 'db_1' }))
  assert.equal(result.status, 400)
  result = await call(url, '/dashboard', { host: targets[0].host, cookie })
  assert.equal(result.status, 200); assert.equal(calls.at(-1).headers.cookie, cookie); assert.equal(calls.at(-1).headers['x-webvue-proxy-token'], token)
  writeFileSync(path, JSON.stringify({ ...registry, targets: targets.map((x, i) => i ? x : { ...x, enabled: false, registryRevision: 2 }) }))
  result = await call(url, '/api/v1/me', { host: targets[0].host, cookie })
  assert.equal(result.status, 403)
})
test('the web CSRF header passes to the Nuxt hop only; other x-webvue headers stay forbidden', () => {
  const web = requestPlan(req(0, { 'x-webvue-csrf': 'c'.repeat(48) }, '/api/commercial/v1/branch-quotes'), registry, token, codec)
  assert.equal(web.odoo, false); assert.equal(web.headers['x-webvue-csrf'], 'c'.repeat(48))
  const odoo = requestPlan(req(0, { 'x-webvue-csrf': 'c'.repeat(48) }), registry, token, codec)
  assert.equal(odoo.odoo, true); assert.equal(odoo.headers['x-webvue-csrf'], undefined)
  for (const header of ['x-webvue-principal', 'x-webvue-tenant-revision', 'x-webvue-csrf-other']) assert.throws(() => requestPlan(req(0, { [header]: 'forged' }, '/api/commercial/v1/branch-quotes'), registry, token, codec))
})
test('guard denies bootstrap hosts and serves the first publication without restart', async t => {
  const path = join(mkdtempSync(join(tmpdir(), 'webvue-guard-empty-')), 'registry.json')
  const bootstrap = { schemaVersion: 1, snapshotRevision: 0, targets: [] }
  writeFileSync(path, JSON.stringify(bootstrap))
  const backend = http.createServer((_req, res) => res.end('first tenant'))
  const backendUrl = await listen(backend)
  const guard = createGuard({ registryPath: path, proxyToken: token, keys, activeKid: 'test', odooUrl: backendUrl, webUrl: backendUrl })
  const url = await listen(guard)
  t.after(() => { guard.closeAllConnections(); guard.close(); backend.closeAllConnections(); backend.close() })
  for (const host of [targets[0].host, 'unknown.example.test']) {
    const result = await call(url, '/api/v1/me', { host })
    assert.equal(result.status, 403)
  }
  const published = mutateRegistry(bootstrap, targets[0], { actor: 'operator', canManageRegistry: true }, 0)
  writeFileSync(path, JSON.stringify(published.registry))
  const result = await call(url, '/api/v1/me', { host: targets[0].host })
  assert.equal(result.status, 200)
  assert.equal(result.text, 'first tenant')
})
