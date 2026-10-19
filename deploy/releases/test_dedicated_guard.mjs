import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createDedicatedGuard } from './dedicated_guard.mjs'
import { loadDedicatedConfig } from './start_dedicated.mjs'

const token = 'synthetic-local-token-'.repeat(3)
const binding = { tenantId: 'tenant_a', database: 'webvue_scratch_dedicated', filestore: 'webvue_scratch_dedicated', identityRevision: 4, host: 'tenant.test', commercialMode: 'non_saas' }
const route = { schemaVersion: 1, tenantId: 'tenant_a', identityRevision: 4, routeRevision: 2, poolId: 'blue', releaseId: 'release_one', fence: 8, state: 'serving' }
const listen = async (server, host = '127.0.0.1') => { server.listen(0, host); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}` }
function call(url, path = '/', headers = {}, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const req = http.request({ hostname: target.hostname.replace(/^\[|\]$/g, ''), port: target.port, path, method: body === undefined ? 'GET' : 'POST', headers: { host: binding.host, ...headers } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject); req.end(body)
  })
}
async function fixture(t, { listenHost, ...guardOptions } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'webvue-dedicated-guard-')))
  const bindingPath = join(root, 'binding.json'); writeFileSync(bindingPath, JSON.stringify(binding))
  const observed = [], control = {}
  control.admitted = new Promise(resolve => { control.mark = resolve })
  const target = kind => http.createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
      observed.push({ kind, headers: req.headers, path: req.url, body: Buffer.concat(chunks).toString() })
      if (kind === 'web' && req.url === '/bff-two-hop' && control.bffHop) { control.bffHop(req, res); return }
      if (req.url === '/slow') { control.reply = res; control.mark(); return }
      res.setHeader('set-cookie', 'session_id=raw-odoo-session; Path=/; HttpOnly'); res.end(kind)
    })
  })
  const odoo = target('odoo'), web = target('web')
  const servers = [odoo, web], sockets = new Set()
  const track = server => server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  servers.forEach(track)
  t.after(async () => { for (const socket of sockets) socket.destroy(); for (const server of servers) await new Promise(resolve => server.close(resolve)) })
  odoo.on('upgrade', (req, socket) => {
    observed.push({ kind: 'ws', headers: req.headers, path: req.url })
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
    socket.on('data', bytes => socket.write('echo:' + bytes.toString()))
  })
  const odooUrl = await listen(odoo), webUrl = await listen(web)
  writeFileSync(join(root, 'tenant_a.json'), JSON.stringify(route))
  writeFileSync(join(root, 'pools.json'), JSON.stringify({ schemaVersion: 1, pools: { blue: { poolId: 'blue', releaseId: 'release_one', odooUrl, webUrl, wsUrl: odooUrl } } }))
  const guard = createDedicatedGuard({ bindingPath, releaseRoutesDir: root, proxyToken: token, ...guardOptions })
  servers.push(guard); track(guard)
  const url = await listen(guard, listenHost)
  return { root, bindingPath, guard, url, observed, control }
}
const internal = { 'x-webvue-proxy-token': token, 'x-webvue-tenant-revision': '4' }

test('dedicated edge routes legacy Odoo paths and passes raw session cookie unchanged', async t => {
  const f = await fixture(t)
  for (const path of ['/api/v1/me', '/web/login', '/odoo/action', '/website/translations', '/base_setup/x', '/bus/x', '/json/x', '/doc/x', '/base/static/a.js', '/report/x', '/mail/x', '/discuss/x']) {
    const response = await call(f.url, path, { cookie: 'session_id=existing-raw-cookie; preference=x' })
    assert.equal(response.status, 200); assert.equal(response.body, 'odoo')
    assert.equal(f.observed.at(-1).headers.cookie, 'session_id=existing-raw-cookie; preference=x')
    assert.equal(response.headers['set-cookie'][0], 'session_id=raw-odoo-session; Path=/; HttpOnly')
  }
  assert.equal((await call(f.url, '/projects')).body, 'web')
})

test('dedicated Nuxt hop preserves browser CSRF while private and Odoo headers stay isolated', async t => {
  const f = await fixture(t)
  const csrf = 'synthetic-browser-csrf-value'
  const headers = { cookie: `session_id=raw; webvue_csrf=${csrf}`, 'x-webvue-csrf': csrf }
  assert.equal((await call(f.url, '/api/commercial/subscription', headers, '{}')).status, 200)
  const forwarded = f.observed.at(-1)
  assert.equal(forwarded.kind, 'web')
  assert.equal(forwarded.headers['x-webvue-csrf'], csrf)
  assert.equal(forwarded.headers.cookie, headers.cookie)
  assert.equal((await call(f.url, '/api/v1/me', headers)).status, 200)
  assert.equal(f.observed.at(-1).kind, 'odoo')
  assert.equal(f.observed.at(-1).headers['x-webvue-csrf'], undefined)
  assert.equal((await call(f.url, '/', { ...headers, 'x-webvue-release-pool': 'green' })).status, 403)
})

test('other Host, browser selectors and private release headers cannot choose a pool or DB', async t => {
  const f = await fixture(t)
  for (const [path, headers] of [['/', { host: 'other.test' }], ['/?db=foreign', {}], ['/', { 'x-webvue-release-pool': 'blue' }], ['/', { 'x-forwarded-host': 'other.test' }]]) {
    assert.equal((await call(f.url, path, headers)).status, 403)
  }
  assert.equal(f.observed.length, 0)
})

test('token and identity revision guard internal pin and auth DB parameter', async t => {
  const f = await fixture(t)
  const body = JSON.stringify({ jsonrpc: '2.0', params: { db: binding.database, login: 'synthetic', password: 'synthetic-test-only' } })
  assert.equal((await call(f.url, '/web/session/authenticate', { 'content-type': 'application/json' }, body)).status, 403)
  assert.equal((await call(f.url, '/web/session/authenticate', { ...internal, 'content-type': 'application/json' }, body)).status, 200)
  assert.equal((await call(f.url, '/web/session/authenticate', { ...internal, 'content-type': 'application/json' }, body.replace(binding.database, 'foreign'))).status, 403)
  assert.equal((await call(f.url, '/', { ...internal, 'x-webvue-tenant-revision': '3' })).status, 403)
  assert.equal((await call(f.url, '/', { ...internal, 'x-webvue-release-pool': 'green', 'x-webvue-release-revision': '1', 'x-webvue-release-fence': '1' })).status, 503)
  assert.equal((await call(f.url, '/', { ...internal, 'x-webvue-release-pool': 'blue', 'x-webvue-release-revision': '2', 'x-webvue-release-fence': '8' })).status, 200)
})

test('maintenance denies every exposed path while privileged status observes current route', async t => {
  const f = await fixture(t)
  writeFileSync(join(f.root, 'tenant_a.maintenance'), '{}')
  for (const path of ['/', '/api/v1/me', '/api/v1/tasks/1/attachments/1/download', '/web/session/authenticate', '/websocket', '/base/static/a.js']) assert.equal((await call(f.url, path, { origin: 'https://' + binding.host })).status, 503)
  assert.equal((await call(f.url, '/_webvue/release-status')).status, 403)
  const status = await call(f.url, '/_webvue/release-status', internal)
  assert.equal(status.status, 200)
  assert.deepEqual(JSON.parse(status.body), { routeRevision: 2, fence: 8, poolId: 'blue', releaseId: 'release_one', maintenance: true, leases: [] })
  assert.equal(f.observed.length, 0)
})

test('trusted socket edge client authority is retained for BFF and overwritten downstream', async t => {
  const f = await fixture(t)
  const response = await call(f.url, '/', { 'x-webvue-client-ip': '192.0.2.5', 'x-webvue-client-host': binding.host, 'x-webvue-client-proto': 'https' })
  assert.equal(response.status, 200)
  const headers = f.observed.at(-1).headers
  assert.equal(headers['x-webvue-client-ip'], '192.0.2.5')
  assert.equal(headers['x-webvue-client-host'], binding.host)
  assert.equal(headers['x-webvue-release-pool'], 'blue')
  assert.equal(headers['x-webvue-proxy-token'], token)
  assert.equal((await call(f.url, '/', { 'x-webvue-client-ip': 'bad', 'x-webvue-client-host': binding.host, 'x-webvue-client-proto': 'https' })).status, 403)
})

test('WebSocket upgrade tunnel holds its lease and carries the raw cookie', async t => {
  const f = await fixture(t)
  const target = new URL(f.url)
  await new Promise((resolve, reject) => {
    const req = http.request({ hostname: target.hostname, port: target.port, path: '/websocket', headers: { host: binding.host, origin: 'https://' + binding.host, connection: 'Upgrade', upgrade: 'websocket', cookie: 'session_id=raw-ws' } })
    const timeout = setTimeout(() => { req.destroy(); reject(Error('upgrade tunnel timed out')) }, 3000)
    req.on('error', error => { clearTimeout(timeout); reject(error) })
    req.on('upgrade', (res, socket) => {
      assert.equal(res.statusCode, 101)
      assert.equal(f.observed.at(-1).headers.cookie, 'session_id=raw-ws')
      const leases = readdirSync(join(f.root, 'leases', 'tenant_a')).filter(name => name.endsWith('.json'))
      assert.equal(leases.length, 1)
      socket.on('data', data => { assert.equal(data.toString(), 'echo:ping'); socket.destroy(); clearTimeout(timeout); resolve() })
      socket.write('ping')
    })
    req.on('response', res => reject(Error('upgrade rejected ' + res.statusCode))); req.end()
  })
})

test('startup reads only local binding, token and release files with no vendor network', async t => {
  const f = await fixture(t)
  const tokenPath = join(f.root, 'proxy-token'); writeFileSync(tokenPath, token, { mode: 0o600 })
  const config = loadDedicatedConfig({ WEBVUE_DEDICATED_BINDING_PATH: f.bindingPath, WEBVUE_RELEASE_ROUTES_DIR: f.root, WEBVUE_DEDICATED_PROXY_TOKEN_FILE: tokenPath })
  assert.equal(config.proxyToken, token)
  assert.equal(config.bindingPath, f.bindingPath)
  assert.throws(() => loadDedicatedConfig({ WEBVUE_DEDICATED_BINDING_PATH: f.bindingPath, WEBVUE_RELEASE_ROUTES_DIR: f.root, WEBVUE_DEDICATED_PROXY_TOKEN: 'short' }))
})

test('running HTTP lease remains visible to maintenance status until response completion', async t => {
  const f = await fixture(t)
  const pending = call(f.url, '/slow')
  await f.control.admitted
  writeFileSync(join(f.root, 'tenant_a.maintenance'), '{}')
  const status = JSON.parse((await call(f.url, '/_webvue/release-status', internal)).body)
  assert.deepEqual(status.leases, [{ poolId: 'blue', operation: 'http' }])
  f.control.reply.end('finished-on-old-pool')
  assert.equal((await pending).body, 'finished-on-old-pool')
  assert.deepEqual(JSON.parse((await call(f.url, '/_webvue/release-status', internal)).body).leases, [])
})

test('untrusted socket peer cannot supply client authority and symlink binding fails startup', async t => {
  const f = await fixture(t, { trustedEdgeAddresses: ['192.0.2.1'] })
  assert.equal((await call(f.url, '/', { 'x-webvue-client-ip': '192.0.2.5', 'x-webvue-client-host': binding.host, 'x-webvue-client-proto': 'https' })).status, 403)
  const link = join(f.root, 'binding-link.json'); symlinkSync(f.bindingPath, link)
  assert.throws(() => createDedicatedGuard({ bindingPath: link, releaseRoutesDir: f.root, proxyToken: token }))
  assert.equal(f.observed.length, 0)
})


test('dedicated retained assets survive pool switch, latest follows active web and maintenance still gates', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'webvue-dedicated-assets-')))
  const store = join(root, 'assets')
  const source = (name, files) => {
    const path = join(root, name); mkdirSync(path)
    for (const [filename, bytes] of Object.entries(files)) {
      const target = join(path, filename); mkdirSync(join(target, '..'), { recursive: true }); writeFileSync(target, bytes)
    }
    return path
  }
  const publish = (path, release) => {
    const done = spawnSync('python3', ['-B', '-c', 'from deploy.releases.assets import publish_assets; import sys; publish_assets(*sys.argv[1:])', path, store, release], { cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8' })
    assert.equal(done.status, 0, 'actual asset publication failed')
  }
  const meta = '/_nuxt/builds/meta/11111111-1111-4111-8111-111111111111.json'
  publish(source('old', { '_nuxt/Old12345.js': 'old-bytes', [meta.slice(1)]: '{"id":"old-meta"}', '_nuxt/builds/latest.json': '{"id":"old"}' }), 'release_one')
  publish(source('new', { '_nuxt/New12345.js': 'new-bytes', '_nuxt/builds/latest.json': '{"id":"new"}' }), 'release_two')
  const f = await fixture(t, { releaseAssetsDir: store })
  const green = http.createServer((req, res) => res.end(req.url === '/_nuxt/builds/latest.json' ? '{"id":"green-live"}' : 'green'))
  const greenUrl = await listen(green)
  t.after(() => { green.closeAllConnections(); green.close() })
  writeFileSync(join(f.root, 'pools.json'), JSON.stringify({ schemaVersion: 1, pools: { green: { poolId: 'green', releaseId: 'release_two', odooUrl: greenUrl, webUrl: greenUrl, wsUrl: greenUrl } } }))
  writeFileSync(join(f.root, 'tenant_a.json'), JSON.stringify({ ...route, routeRevision: 3, fence: 9, poolId: 'green', releaseId: 'release_two' }))
  for (const [path, expected] of [['/_nuxt/Old12345.js', 'old-bytes'], [meta, '{"id":"old-meta"}']]) {
    const result = await call(f.url, path)
    assert.equal(result.status, 200); assert.equal(result.body, expected)
    assert.match(result.headers['cache-control'], /immutable/)
    assert.equal(result.headers['x-webvue-proxy-token'], undefined); assert.equal(result.headers['set-cookie'], undefined)
    const head = await new Promise((resolve, reject) => {
      const url = new URL(f.url)
      const req = http.request({ hostname: url.hostname, port: url.port, path, method: 'HEAD', headers: { host: binding.host } }, res => { let body = ''; res.on('data', bytes => { body += bytes }); res.on('end', () => resolve({ status: res.statusCode, body })) })
      req.on('error', reject); req.end()
    })
    assert.deepEqual(head, { status: 200, body: '' })
  }
  assert.equal((await call(f.url, '/_nuxt/Missing1.js')).status, 404)
  assert.equal((await call(f.url, '/_nuxt/builds/latest.json')).body, '{"id":"green-live"}')
  assert.deepEqual(JSON.parse((await call(f.url, '/_webvue/release-status', internal)).body).leases, [])
  writeFileSync(join(f.root, 'tenant_a.maintenance'), '{}')
  assert.equal((await call(f.url, '/_nuxt/Old12345.js')).status, 503)
  assert.equal(f.observed.length, 0)
})

test('dedicated asset store startup is explicit and rejects symlink roots', async t => {
  const f = await fixture(t)
  const store = join(f.root, 'assets'); mkdirSync(store)
  const config = loadDedicatedConfig({ WEBVUE_DEDICATED_BINDING_PATH: f.bindingPath, WEBVUE_RELEASE_ROUTES_DIR: f.root, WEBVUE_DEDICATED_PROXY_TOKEN: token, WEBVUE_RELEASE_ASSETS_DIR: store })
  assert.equal(config.releaseAssetsDir, store)
  const alias = join(f.root, 'asset-alias'); symlinkSync(store, alias)
  assert.throws(() => createDedicatedGuard({ bindingPath: f.bindingPath, releaseRoutesDir: f.root, proxyToken: token, releaseAssetsDir: alias }))
})


test('authenticated BFF hop preserves original edge authority while an untrusted public peer cannot spoof it', async t => {
  const f = await fixture(t, { trustedEdgeAddresses: ['::ffff:127.0.0.1'], listenHost: '::' })
  const edge = { 'x-webvue-client-ip': '198.51.100.9', 'x-webvue-client-host': binding.host, 'x-webvue-client-proto': 'https' }
  const bffUrl = f.url.replace('127.0.0.1', '[::1]')
  f.control.bffHop = async (req, res) => {
    try {
      const headers = Object.fromEntries(['x-webvue-proxy-token', 'x-webvue-tenant-revision', 'x-webvue-release-pool', 'x-webvue-release-revision', 'x-webvue-release-fence', 'x-webvue-release-admission', ...Object.keys(edge)].filter(name => req.headers[name] !== undefined).map(name => [name, req.headers[name]]))
      const response = await call(bffUrl, '/api/v1/me', headers)
      res.writeHead(response.status); res.end(response.body)
    } catch { res.writeHead(500); res.end('bff_test_failed') }
  }
  const result = await call(f.url, '/bff-two-hop', edge)
  assert.equal(result.status, 200); assert.equal(result.body, 'odoo')
  const downstream = f.observed.at(-1)
  assert.equal(downstream.kind, 'odoo')
  assert.equal(downstream.headers['x-forwarded-for'], edge['x-webvue-client-ip'])
  assert.equal(downstream.headers['x-forwarded-host'], binding.host)
  assert.equal(downstream.headers['x-forwarded-proto'], 'https')
  assert.equal(downstream.headers['x-webvue-client-ip'], undefined)
  assert.equal(downstream.headers['x-webvue-proxy-token'], undefined)
  const count = f.observed.length
  for (const headers of [edge, { ...edge, 'x-webvue-proxy-token': 'invalid' },
    { ...edge, ...internal, 'x-webvue-tenant-revision': '3' },
    { ...edge, ...internal, 'x-webvue-client-ip': '198.51.100.9, 127.0.0.1' },
    { ...edge, ...internal, 'x-webvue-client-host': 'foreign.test' },
    { ...edge, ...internal, 'x-webvue-client-proto': 'ftp' },
    { ...internal, 'x-webvue-client-ip': edge['x-webvue-client-ip'] }]) {
    assert.equal((await call(bffUrl, '/api/v1/me', headers)).status, 403)
  }
  assert.equal(f.observed.length, count)
  assert.deepEqual(JSON.parse((await call(f.url, '/_webvue/release-status', internal)).body).leases, [])
})
