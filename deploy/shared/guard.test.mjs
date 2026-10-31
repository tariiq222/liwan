import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionCodec, requestPlan, prospectPlan, createGuard } from './guard.mjs'
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
    const browser = requestPlan(req(i, { cookie }), registry, token, codec)
    assert.equal(browser.odoo, false)
    assert.equal(browser.headers.cookie, cookie)
    assert.equal(browser.headers.host, targets[i].host)
    const internal = requestPlan(req(i, { cookie, 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '1' }), registry, token, codec)
    assert.equal(internal.odoo, true)
    assert.equal(internal.headers.cookie, `session_id=sid_${i}`)
    assert.equal(internal.headers.host, targets[i].database)
    for (let j = 0; j < 10; j++) if (i !== j) assert.throws(() => requestPlan(req(j, { cookie }), registry, token, codec))
  }
})
test('raw/tampered/expired/revoked sessions, selectors, header and route bypass deny', () => {
  const signed = codec.seal('sid_a', targets[0])
  for (const cookie of ['session_id=raw', `session_id=${signed}x`, `session_id=${signed}; session_id=${signed}`]) assert.throws(() => requestPlan(req(0, { cookie }), registry, token, codec))
  for (const header of ['x-odoo-database', 'x-openerp-session-id', 'x-forwarded-host', 'forwarded', 'x-liwan-proxy-token']) assert.throws(() => requestPlan(req(0, { [header]: 'forged' }), registry, token, codec))
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
test('rejected sessions recover only on exact public auth routes without forwarding identity', () => {
  const current = { ...registry, targets: [{ ...targets[0], registryRevision: 2 }] }
  const invalid = [codec.seal('old_sid', targets[0]), codec.seal('foreign_sid', targets[1]), 'raw', `${codec.seal('sid', targets[0])}x`, sessionCodec(keys, 'test', () => 0).seal('expired', targets[0])]
  for (const value of invalid) {
    const cookie = `session_id=${value}; locale=ar`
    for (const [url, method] of [['/login', 'GET'], ['/login?next=%2Fdashboard', 'HEAD'], ['/api/auth/login', 'POST'], ['/api/auth/logout', 'POST']]) {
      const plan = requestPlan({ ...req(0, { cookie }, url), method }, current, token, codec)
      assert.equal(plan.clearSession, true)
      assert.equal(plan.headers.cookie, 'locale=ar')
    }
    for (const url of ['/dashboard', '/api/v1/me', '/api/auth/login/extra', '/api/auth/login/', '/login/', '/other/../api/auth/login', '/api/auth/login#ignored']) {
      assert.throws(() => requestPlan({ ...req(0, { cookie }, url), method: 'POST' }, current, token, codec))
    }
    assert.throws(() => requestPlan({ ...req(0, { cookie }, '/api/auth/login'), method: 'GET' }, current, token, codec))
    const disabled = { ...current, targets: [{ ...current.targets[0], enabled: false }] }
    assert.throws(() => requestPlan({ ...req(0, { cookie }, '/login'), method: 'GET' }, disabled, token, codec))
    assert.throws(() => requestPlan({ ...req(0, { cookie, 'x-forwarded-host': 'forged' }, '/login'), method: 'GET' }, current, token, codec))
  }
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
  const root = mkdtempSync(join(tmpdir(), 'liwan-guard-test-'))
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
  const trusted = { host: targets[0].host, 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '1', 'content-type': 'application/json' }
  let result = await call(url, '/web/session/authenticate', trusted, JSON.stringify({ params: { db: 'db_0', login: 'user', password: 'not-secret-fixture' } }))
  assert.equal(result.status, 200); assert.equal(calls[0].headers.host, 'db_0')
  const cookie = result.headers['set-cookie'][0].split(';')[0]
  assert.match(result.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Lax/)
  assert.equal(codec.open(cookie.slice(11), targets[0]), 'odoo_sid')
  result = await call(url, '/api/v1/auth/totp', { host: targets[0].host, cookie })
  assert.equal(result.status, 200); assert.equal(calls.at(-1).headers.cookie, cookie)
  assert.equal(calls.at(-1).headers.host, targets[0].host)
  result = await call(url, '/api/v1/auth/totp', { ...trusted, cookie })
  assert.equal(result.status, 200); assert.equal(calls.at(-1).headers.cookie, 'session_id=odoo_sid')
  // Attachments are served only by the owning /api/v1 routes: stock /web/content never reaches Odoo.
  const beforeContent = calls.length
  result = await call(url, '/web/content/1', { host: targets[0].host, cookie })
  assert.equal(result.status, 403); assert.equal(calls.length, beforeContent)
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
  assert.equal(result.status, 200); assert.equal(calls.at(-1).headers.cookie, cookie); assert.equal(calls.at(-1).headers['x-liwan-proxy-token'], token)
  writeFileSync(path, JSON.stringify({ ...registry, targets: targets.map((x, i) => i ? x : { ...x, enabled: false, registryRevision: 2 }) }))
  result = await call(url, '/api/v1/me', { host: targets[0].host, cookie })
  assert.equal(result.status, 403)
})
test('HTTP recovery clears rejected cookies and preserves a newly issued session', async t => {
  const root = mkdtempSync(join(tmpdir(), 'liwan-guard-recovery-'))
  const path = join(root, 'registry.json')
  const current = { ...targets[0], registryRevision: 2 }
  writeFileSync(path, JSON.stringify({ ...registry, targets: [current] }))
  const calls = []
  const freshCookie = `session_id=${codec.seal('fresh_sid', current)}; Path=/; HttpOnly; Secure; SameSite=Lax`
  const backend = http.createServer((req, res) => {
    calls.push({ url: req.url, cookie: req.headers.cookie })
    if (req.url === '/api/auth/login') res.setHeader('set-cookie', [freshCookie])
    res.end('ok')
  })
  const backendUrl = await listen(backend)
  const guard = createGuard({ registryPath: path, proxyToken: token, keys, activeKid: 'test', odooUrl: backendUrl, webUrl: backendUrl })
  const url = await listen(guard)
  t.after(() => { guard.closeAllConnections(); guard.close(); backend.closeAllConnections(); backend.close() })
  const headers = { host: current.host, cookie: `session_id=${codec.seal('old_sid', targets[0])}; locale=ar`, 'content-type': 'application/json' }
  for (const route of ['/login', '/api/auth/logout']) {
    const reply = await call(url, route, headers, route.startsWith('/api/') ? '{}' : undefined)
    assert.equal(reply.status, 200)
    assert.equal(calls.at(-1).cookie, 'locale=ar')
    assert.match(reply.headers['set-cookie'].join(';'), /session_id=; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=0/)
    assert.equal(reply.headers['cache-control'], 'no-store')
  }
  const login = await call(url, '/api/auth/login', headers, '{}')
  assert.equal(login.status, 200)
  const issued = login.headers['set-cookie'].filter(value => value.startsWith('session_id='))
  assert.deepEqual(issued, [freshCookie])
  const me = await call(url, '/api/v1/me', { host: current.host, cookie: issued[0].split(';')[0] })
  assert.equal(me.status, 200)
  assert.equal(calls.at(-1).cookie, issued[0].split(';')[0])
  await call(url, '/api/v1/me', { host: current.host, cookie: issued[0].split(';')[0], 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '2' })
  assert.equal(calls.at(-1).cookie, 'session_id=fresh_sid')
  const before = calls.length
  assert.equal((await call(url, '/api/v1/me', headers)).status, 403)
  assert.equal(calls.length, before)
})
test('the web CSRF header passes to the Nuxt hop only; other x-liwan headers stay forbidden', () => {
  const web = requestPlan(req(0, { 'x-liwan-csrf': 'c'.repeat(48) }, '/api/commercial/v1/branch-quotes'), registry, token, codec)
  assert.equal(web.odoo, false); assert.equal(web.headers['x-liwan-csrf'], 'c'.repeat(48))
  const odoo = requestPlan(req(0, { 'x-liwan-csrf': 'c'.repeat(48), 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '1' }), registry, token, codec)
  assert.equal(odoo.odoo, true); assert.equal(odoo.headers['x-liwan-csrf'], undefined)
  for (const header of ['x-liwan-principal', 'x-liwan-tenant-revision', 'x-liwan-csrf-other']) assert.throws(() => requestPlan(req(0, { [header]: 'forged' }, '/api/commercial/v1/branch-quotes'), registry, token, codec))
})
test('the UI language header passes only on the trusted hop with ar or en and reaches Odoo', () => {
  const trusted = { 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '1' }
  for (const value of ['ar', 'en']) {
    const plan = requestPlan(req(0, { ...trusted, 'x-liwan-ui-locale': value }, '/api/v1/me'), registry, token, codec)
    assert.equal(plan.odoo, true)
    assert.equal(plan.headers['x-liwan-ui-locale'], value)
  }
  for (const value of ['fr', 'ar_001', '', 'AR']) assert.throws(() => requestPlan(req(0, { ...trusted, 'x-liwan-ui-locale': value }, '/api/v1/me'), registry, token, codec), /forbidden_header/)
  assert.throws(() => requestPlan(req(0, { 'x-liwan-ui-locale': 'ar' }, '/api/v1/me'), registry, token, codec), /forbidden_header/)
})
test('guard denies bootstrap hosts and serves the first publication without restart', async t => {
  const path = join(mkdtempSync(join(tmpdir(), 'liwan-guard-empty-')), 'registry.json')
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

// Body credits are four per hop pool: four hung forwards would admit nothing else if a departed caller kept them.
const BODY_CREDITS = 4
const settle = async () => { for (let turn = 0; turn < 50; turn++) await new Promise(resolve => setImmediate(resolve)) }
async function hungGuard(t) {
  const path = join(mkdtempSync(join(tmpdir(), 'liwan-guard-hung-')), 'registry.json')
  writeFileSync(path, JSON.stringify(registry))
  const hung = []
  let closed = 0
  const backend = http.createServer((req, res) => {
    req.resume()
    req.once('end', () => { if (req.headers['x-test-hang']) { hung.push({ res }); res.once('close', () => { closed++ }) } else res.end('ok') })
  })
  const backendUrl = await listen(backend)
  const guard = createGuard({ registryPath: path, proxyToken: token, keys, activeKid: 'test', odooUrl: backendUrl, webUrl: backendUrl })
  const url = await listen(guard)
  t.after(() => { mock.timers.reset(); guard.closeAllConnections(); guard.close(); backend.closeAllConnections(); backend.close() })
  const hang = async (route, headers) => {
    const clients = Array.from({ length: BODY_CREDITS }, () => {
      const client = http.request(new URL(route, url), { method: 'POST', headers: { host: targets[0].host, 'content-type': 'application/json', 'x-test-hang': '1', ...headers } })
      client.on('error', () => {})
      client.end('{}')
      return client
    })
    while (hung.length < BODY_CREDITS) await new Promise(resolve => setImmediate(resolve))
    return { clients, upstreamClosed: () => closed, hung }
  }
  return { url, hang }
}

test('a departed external caller cannot pin body credits behind a hung auth target', async t => {
  const { url, hang } = await hungGuard(t)
  const { clients, upstreamClosed } = await hang('/api/auth/login', {})
  for (const client of clients) client.destroy()
  const next = await call(url, '/api/auth/login', { host: targets[0].host, 'content-type': 'application/json' }, '{}')
  assert.equal(next.status, 200)
  await settle()
  assert.equal(upstreamClosed(), BODY_CREDITS)
})

test('a departed internal caller keeps its credit for one deadline, then the hung target is cancelled', async t => {
  const { url, hang } = await hungGuard(t)
  mock.timers.enable({ apis: ['setTimeout'] })
  const { clients, upstreamClosed } = await hang('/api/v1/hang', { 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '1' })
  for (const client of clients) client.destroy()
  await settle()
  assert.equal(upstreamClosed(), 0)
  mock.timers.tick(15_000)
  mock.timers.reset()
  await settle()
  assert.equal(upstreamClosed(), BODY_CREDITS)
  const next = await call(url, '/api/v1/me', { host: targets[0].host, 'content-type': 'application/json', 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '1' }, '{}')
  assert.equal(next.status, 200)
})

test('a write whose caller stays connected is not cancelled', async t => {
  const { url, hang } = await hungGuard(t)
  const { clients, upstreamClosed, hung } = await hang('/api/auth/login', {})
  await settle()
  assert.equal(upstreamClosed(), 0)
  const replies = clients.map(client => new Promise(resolve => client.once('response', reply => { reply.resume(); resolve(reply.statusCode) })))
  for (const { res } of hung) res.end('late')
  assert.deepEqual(await Promise.all(replies), Array(BODY_CREDITS).fill(200))
})

const prospect = (url, headers = {}, method = 'GET', host = 'app.liwan.test') => ({ headers: { host, ...headers }, url, method })
test('the LiwanOS public host serves only the payment-done page, the payment relay and assets, with the token injected', () => {
  for (const [url, method] of [['/payment-done', 'GET'], ['/payment-done?result=paid', 'HEAD'], ['/api/commercial/payment-callback?attempt=x', 'GET'], ['/api/commercial/payment-callback?attempt=x', 'POST'], ['/_nuxt/entry.abc.js', 'GET']]) {
    const plan = prospectPlan(prospect(url, { cookie: 'session_id=raw', authorization: 'Bearer x', 'x-liwan-proxy-token': 'forged', 'x-forwarded-host': 'evil', 'x-liwan-csrf': 'c' }, method), 'app.liwan.test', token)
    assert.equal(plan.prospect, true); assert.equal(plan.tenant, null); assert.equal(plan.odoo, false); assert.equal(plan.internal, false)
    assert.equal(plan.headers['x-liwan-proxy-token'], token)
    for (const name of ['cookie', 'authorization', 'x-forwarded-host', 'x-liwan-csrf']) assert.equal(plan.headers[name], undefined)
    assert.equal(plan.headers.host, 'app.liwan.test'); assert.equal(plan.path, url)
  }
  assert.equal(prospectPlan(prospect('/payment-done', {}, 'GET', 'APP.liwan.test'), 'app.liwan.test', token).prospect, true)
})
test('the public host refuses everything else, and other hosts never take the prospect route', () => {
  for (const [url, method] of [['/api/v1/me', 'GET'], ['/login', 'GET'], ['/api/commercial/v1/subscription', 'GET'], ['/payment-done', 'POST'], ['/api/commercial/payment-callback', 'PUT'], ['/_nuxt/', 'GET'], ['/_nuxt/../api/v1/me', 'GET'], ['/payment-done/../login', 'GET'], ['/payment-done?db=x', 'GET'], ['//evil.test/payment-done', 'GET'], ['/websocket', 'GET']]) {
    assert.throws(() => prospectPlan(prospect(url, {}, method), 'app.liwan.test', token), undefined, `${method} ${url}`)
  }
  assert.throws(() => prospectPlan(prospect('/payment-done'), 'app.liwan.test', 'short'), /invalid_proxy_token/)
  // Not the prospect host: null, so the tenant boundary decides (an unknown host is refused there).
  assert.equal(prospectPlan(prospect('/payment-done', {}, 'GET', 'acme.liwan.test'), 'app.liwan.test', token), null)
  assert.equal(prospectPlan(prospect('/payment-done'), undefined, token), null)
  assert.throws(() => requestPlan(prospect('/payment-done', {}, 'GET', 'unknown.test'), registry, token, codec))
  assert.throws(() => requestPlan(prospect('/payment-done'), registry, token, codec))
})
