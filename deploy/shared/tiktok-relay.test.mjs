import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createHmac } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTiktokRelay } from './tiktok-relay.mjs'

const NOW = 1_700_000_000
const SECRET = 'test-only-tiktok-client-secret'
const PROXY_TOKEN = 'test-only-relay-proxy-token-'.repeat(2)
const MAX_BODY = 1024 * 1024
const targets = [
  { host: 'acme.example.test', tenantId: 'acme', database: 'liwan_scratch_acme', filestore: 'liwan_scratch_acme', enabled: true, registryRevision: 1 },
  { host: 'beta.example.test', tenantId: 'beta', database: 'liwan_scratch_beta', filestore: 'liwan_scratch_beta', enabled: true, registryRevision: 2 },
]
const bindings = { schemaVersion: 1, bindings: { openid_acme: 'acme', openid_beta: 'beta', openid_gone: 'gone' } }

const listen = server => new Promise(resolve => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port))
})
const close = server => new Promise(resolve => {
  server.close(resolve)
  server.closeAllConnections?.()
})

function registryFile(dir, snapshot = { schemaVersion: 1, snapshotRevision: 1, targets }) {
  const path = join(dir, 'registry.json')
  writeFileSync(path, JSON.stringify(snapshot))
  return path
}

function bindingsFile(dir, value = bindings) {
  const path = join(dir, 'bindings.json')
  writeFileSync(path, JSON.stringify(value))
  return path
}

function sign(raw, at = NOW) {
  const timestamp = String(at)
  return `t=${timestamp},s=${createHmac('sha256', SECRET).update(`${timestamp}.`).update(raw).digest('hex')}`
}

function delivery(openId, at = NOW) {
  const raw = Buffer.from(JSON.stringify({ event: 'im_receive_msg', user_openid: openId, content: 'hello' }))
  return { raw, signature: sign(raw, at) }
}

/** The exact state `controllers/tiktok_oauth.py: encode_state` produces: compact JSON with sorted
 * keys, unpadded base64url, and the HMAC-SHA256 hex of that payload with the client secret. */
function signState(fields) {
  const sorted = Object.fromEntries(Object.keys(fields).sort().map(key => [key, fields[key]]))
  const payload = Buffer.from(JSON.stringify(sorted)).toString('base64url')
  return `${payload}.${createHmac('sha256', SECRET).update(payload).digest('hex')}`
}

/** A stand-in tenant origin that records exactly what the relay forwarded. */
async function startTenant() {
  const requests = []
  let status = 200
  let body = 'ok'
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    requests.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) })
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(body)
  })
  const port = await listen(server)
  return {
    requests,
    respond(nextStatus, nextBody = 'ok') { status = nextStatus; body = nextBody },
    origin: () => `http://127.0.0.1:${port}`,
    close: () => close(server),
  }
}

async function startRelay({ tenant, dir, registry, bindings: seed = bindings, ...options }) {
  const server = createTiktokRelay({
    clientSecret: SECRET,
    proxyToken: PROXY_TOKEN,
    registryPath: registryFile(dir, registry),
    // `false` starts on the file an earlier relay instance already wrote, as a container restart does.
    bindingsPath: seed === false ? join(dir, 'bindings.json') : bindingsFile(dir, seed),
    tenantOrigin: tenant.origin,
    now: () => NOW,
    ...options,
  })
  return { server, port: await listen(server) }
}

function post(port, raw, signature) {
  return fetch(`http://127.0.0.1:${port}/tiktok/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(signature === undefined ? {} : { 'tiktok-signature': signature }) },
    body: raw,
  })
}

/** One internal binding call, with the shared proxy token unless the test omits or replaces it. */
async function bind(port, openId, { method = 'PUT', tenantId, token = PROXY_TOKEN, body } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token !== null) headers['x-liwan-proxy-token'] = token
  const response = await fetch(`http://127.0.0.1:${port}/internal/tiktok/bindings/${openId}`, {
    method,
    headers,
    body: method === 'DELETE' ? undefined : body ?? JSON.stringify({ tenant_id: tenantId }),
  })
  return { status: response.status, body: await response.text() }
}

const storedBindings = dir => JSON.parse(readFileSync(join(dir, 'bindings.json'), 'utf8'))

async function fixture(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tiktok-relay-'))
  const tenant = await startTenant()
  const { server, port } = await startRelay({ tenant, dir, ...options })
  return {
    dir,
    tenant,
    port,
    async close() {
      await close(server)
      await tenant.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

test('a valid delivery reaches the tenant unchanged and the answer waits for it', async () => {
  const f = await fixture()
  try {
    const { raw, signature } = delivery('openid_acme')
    f.tenant.respond(202, '{"code":0,"message":"stored"}')
    const response = await post(f.port, raw, signature)
    assert.equal(response.status, 202)
    assert.equal(await response.text(), '{"code":0,"message":"stored"}')
    assert.equal(f.tenant.requests.length, 1)
    const forwarded = f.tenant.requests[0]
    assert.equal(forwarded.method, 'POST')
    assert.equal(forwarded.url, '/api/v1/inbox/hooks/tiktok')
    assert.deepEqual(forwarded.body, raw)
    assert.equal(forwarded.headers['tiktok-signature'], signature)
    assert.equal(forwarded.headers['content-type'], 'application/json')
    // The public tenant hop never carries the shared proxy token or a registry revision: the shared
    // edge refuses any inbound X-Liwan-Proxy-Token (403), and the tenant's guard strips both on the
    // public hop anyway. The relay presents that secret only to its internal binding API.
    assert.equal(forwarded.headers['x-liwan-proxy-token'], undefined)
    assert.equal(forwarded.headers['x-liwan-tenant-revision'], undefined)
  } finally { await f.close() }
})

test('the signature age window is five seconds', async () => {
  const f = await fixture()
  try {
    const stale = delivery('openid_acme', NOW - 6)
    assert.equal((await post(f.port, stale.raw, stale.signature)).status, 403)
    assert.equal(f.tenant.requests.length, 0)
    const fresh = delivery('openid_acme', NOW - 4)
    assert.equal((await post(f.port, fresh.raw, fresh.signature)).status, 200)
    assert.equal(f.tenant.requests.length, 1)
  } finally { await f.close() }
})

test('a missing, truncated or forged signature is refused', async () => {
  const f = await fixture()
  try {
    const { raw, signature } = delivery('openid_acme')
    assert.equal((await post(f.port, raw)).status, 403)
    assert.equal((await post(f.port, raw, signature.slice(0, -1))).status, 403)
    assert.equal((await post(f.port, raw, signature.replace(/.$/, c => (c === '0' ? '1' : '0')))).status, 403)
    assert.equal((await post(f.port, Buffer.from(`${raw.toString()} `), signature)).status, 403)
    assert.equal(f.tenant.requests.length, 0)
  } finally { await f.close() }
})

test('an unknown open id answers 200 and forwards nothing', async () => {
  const f = await fixture()
  try {
    const unknown = delivery('openid_unknown')
    assert.equal((await post(f.port, unknown.raw, unknown.signature)).status, 200)
    const bare = Buffer.from(JSON.stringify({ event: 'im_receive_msg' }))
    assert.equal((await post(f.port, bare, sign(bare))).status, 200)
    assert.equal(f.tenant.requests.length, 0)
  } finally { await f.close() }
})

test('a binding whose tenant left the registry is ignored, and a disabled tenant too', async () => {
  const f = await fixture()
  try {
    const gone = delivery('openid_gone')
    assert.equal((await post(f.port, gone.raw, gone.signature)).status, 200)
    assert.equal(f.tenant.requests.length, 0)
    registryFile(f.dir, { schemaVersion: 1, snapshotRevision: 2, targets: [{ ...targets[0], enabled: false }, targets[1]] })
    const disabled = delivery('openid_acme')
    assert.equal((await post(f.port, disabled.raw, disabled.signature)).status, 200)
    assert.equal(f.tenant.requests.length, 0)
  } finally { await f.close() }
})

test('a tenant that answers 5xx turns into 502 so TikTok retries', async () => {
  const f = await fixture()
  try {
    f.tenant.respond(500, 'boom')
    const { raw, signature } = delivery('openid_acme')
    assert.equal((await post(f.port, raw, signature)).status, 502)
    assert.equal(f.tenant.requests.length, 1)
  } finally { await f.close() }
})

test('a malformed bindings file fails closed instead of forwarding', async () => {
  const f = await fixture()
  try {
    bindingsFile(f.dir, { schemaVersion: 2, bindings: {} })
    const { raw, signature } = delivery('openid_acme')
    assert.equal((await post(f.port, raw, signature)).status, 500)
    assert.equal(f.tenant.requests.length, 0)
  } finally { await f.close() }
})

test('an oversized delivery is refused before the body is read or forwarded', async () => {
  const f = await fixture()
  try {
    const status = await new Promise((resolve, reject) => {
      const request = http.request({
        port: f.port,
        path: '/tiktok/webhook',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': String(MAX_BODY + 1), 'tiktok-signature': sign(Buffer.alloc(0)) },
      }, response => { response.resume(); resolve(response.statusCode) })
      request.on('error', reject)
      request.end('{}')
    })
    assert.equal(status, 413)
    assert.equal(f.tenant.requests.length, 0)
  } finally { await f.close() }
})

test('the OAuth callback bounces the unchanged query to the tenant host', async () => {
  const f = await fixture()
  try {
    const state = signState({ c: 'acme', u: 7, ch: 0, n: 'Acme', d: 0, h: 'acme.example.test', x: NOW + 600 })
    const query = `?code=code_123&state=${state}`
    const response = await fetch(`http://127.0.0.1:${f.port}/tiktok/oauth/callback${query}`, { redirect: 'manual' })
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('location'), `https://acme.example.test/api/v1/inbox/tiktok/callback${query}`)
  } finally { await f.close() }
})

test('an Odoo state naming the tenant database bounces to its public host', async () => {
  // In shared hosting the guard rewrites the Odoo hop's Host to the tenant database, so the
  // request host Odoo signs into `h` is the database identifier, never the public host.
  const f = await fixture()
  try {
    const state = signState({ c: 'acme', u: 7, ch: 0, n: 'Acme', d: 0, h: 'liwan_scratch_acme', x: NOW + 600 })
    const query = `?code=code_123&state=${state}`
    const response = await fetch(`http://127.0.0.1:${f.port}/tiktok/oauth/callback${query}`, { redirect: 'manual' })
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('location'), `https://acme.example.test/api/v1/inbox/tiktok/callback${query}`)
  } finally { await f.close() }
})

test('a tampered state or an unknown host answers 400 without echoing the input', async () => {
  const f = await fixture()
  try {
    const state = signState({ c: 'acme', u: 7, ch: 0, n: 'NAME_MUST_NOT_ECHO', d: 0, h: 'acme.example.test', x: NOW + 600 })
    const tampered = `${state.slice(0, -1)}${state.at(-1) === '0' ? '1' : '0'}`
    const unknownHost = signState({ c: 'acme', u: 7, ch: 0, n: 'NAME_MUST_NOT_ECHO', d: 0, h: 'evil.example.test', x: NOW + 600 })
    const unknownDatabase = signState({ c: 'acme', u: 7, ch: 0, n: 'NAME_MUST_NOT_ECHO', d: 0, h: 'liwan_scratch_unknown', x: NOW + 600 })
    for (const value of [tampered, unknownHost, unknownDatabase, 'not-a-state', '', signState({ h: 'acme.example.test' }).slice(0, 10)]) {
      const response = await fetch(`http://127.0.0.1:${f.port}/tiktok/oauth/callback?code=code_123&state=${value}`, { redirect: 'manual' })
      assert.equal(response.status, 400)
      const body = await response.text()
      assert.ok(!body.includes('NAME_MUST_NOT_ECHO'))
      assert.ok(!body.includes('acme.example.test'))
      assert.ok(!body.includes('code_123'))
    }
  } finally { await f.close() }
})

// The internal binding API is how a tenant's Odoo registers

test('a binding registers the account and routes its events to that tenant', async () => {
  const f = await fixture({ bindings: { schemaVersion: 1, bindings: {} } })
  try {
    assert.equal((await bind(f.port, 'openid_new', { tenantId: 'acme' })).status, 200)
    assert.deepEqual(storedBindings(f.dir), { schemaVersion: 1, bindings: { openid_new: 'acme' } })
    const { raw, signature } = delivery('openid_new')
    assert.equal((await post(f.port, raw, signature)).status, 200)
    assert.equal(f.tenant.requests.length, 1)
    assert.equal(f.tenant.requests[0].url, '/api/v1/inbox/hooks/tiktok')
  } finally { await f.close() }
})

test('a binding survives a relay restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tiktok-relay-'))
  const tenant = await startTenant()
  try {
    const first = await startRelay({ tenant, dir, bindings: { schemaVersion: 1, bindings: {} } })
    assert.equal((await bind(first.port, 'openid_new', { tenantId: 'acme' })).status, 200)
    // The file is replaced atomically: no temporary sibling stays behind and the file is the contract.
    assert.deepEqual(readdirSync(dir).filter(name => name.endsWith('.tmp')), [])
    assert.deepEqual(storedBindings(dir), { schemaVersion: 1, bindings: { openid_new: 'acme' } })
    await close(first.server)
    const second = await startRelay({ tenant, dir, bindings: false })
    try {
      const { raw, signature } = delivery('openid_new')
      assert.equal((await post(second.port, raw, signature)).status, 200)
      assert.equal(tenant.requests.length, 1)
    } finally { await close(second.server) }
  } finally { await tenant.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('a tenant resends its own binding idempotently', async () => {
  const f = await fixture({ bindings: { schemaVersion: 1, bindings: {} } })
  try {
    assert.equal((await bind(f.port, 'openid_new', { tenantId: 'acme' })).status, 200)
    assert.equal((await bind(f.port, 'openid_new', { tenantId: 'acme' })).status, 200)
    assert.deepEqual(storedBindings(f.dir), { schemaVersion: 1, bindings: { openid_new: 'acme' } })
  } finally { await f.close() }
})

test('an account bound to another active tenant answers 409 and keeps its routing', async () => {
  const f = await fixture()
  try {
    assert.equal((await bind(f.port, 'openid_acme', { tenantId: 'beta' })).status, 409)
    assert.deepEqual(storedBindings(f.dir), bindings)
  } finally { await f.close() }
})

test('a binding whose tenant left the registry is replaced, and its events now reach the new tenant', async () => {
  const f = await fixture()
  try {
    assert.equal((await bind(f.port, 'openid_gone', { tenantId: 'acme' })).status, 200)
    assert.equal(storedBindings(f.dir).bindings.openid_gone, 'acme')
    const { raw, signature } = delivery('openid_gone')
    assert.equal((await post(f.port, raw, signature)).status, 200)
    assert.equal(f.tenant.requests.length, 1)
  } finally { await f.close() }
})

test('the tenant database identifier binds the registry target it belongs to', async () => {
  // Shared hosting hands Odoo its database, not the registry tenant id.
  const f = await fixture({ bindings: { schemaVersion: 1, bindings: {} } })
  try {
    assert.equal((await bind(f.port, 'openid_new', { tenantId: 'liwan_scratch_beta' })).status, 200)
    assert.deepEqual(storedBindings(f.dir), { schemaVersion: 1, bindings: { openid_new: 'beta' } })
    const { raw, signature } = delivery('openid_new')
    assert.equal((await post(f.port, raw, signature)).status, 200)
    assert.equal(f.tenant.requests.length, 1)
  } finally { await f.close() }
})

test('a wrong, missing or truncated proxy token is refused before anything changes', async () => {
  const f = await fixture()
  try {
    for (const token of [null, 'wrong-token-wrong-token-wrong-token!', `${PROXY_TOKEN}x`]) {
      assert.equal((await bind(f.port, 'openid_new', { tenantId: 'acme', token })).status, 403)
      assert.equal((await bind(f.port, 'openid_acme', { method: 'DELETE', token })).status, 403)
    }
    assert.deepEqual(storedBindings(f.dir), bindings)
  } finally { await f.close() }
})

test('a binding names an active registry target and nothing else', async () => {
  const f = await fixture()
  try {
    const disabled = { schemaVersion: 1, snapshotRevision: 2, targets: [{ ...targets[0], enabled: false }, targets[1]] }
    registryFile(f.dir, disabled)
    assert.equal((await bind(f.port, 'openid_new', { tenantId: 'acme' })).status, 422)
    assert.equal((await bind(f.port, 'openid_new', { tenantId: 'nobody' })).status, 422)
    assert.equal((await bind(f.port, 'openid_new', { tenantId: 'liwan_scratch_acme' })).status, 422)
    assert.deepEqual(storedBindings(f.dir), bindings)
  } finally { await f.close() }
})

test('a malformed binding request is refused and the file keeps its contract', async () => {
  const f = await fixture()
  try {
    assert.equal((await bind(f.port, 'openid_new', { body: '{' })).status, 400)
    assert.equal((await bind(f.port, 'openid_new', { body: '{}' })).status, 400)
    assert.equal((await bind(f.port, 'openid_new', { body: '{"tenant_id": 7}' })).status, 400)
    assert.equal((await bind(f.port, 'not/a/single/segment', { tenantId: 'acme' })).status, 400)
    assert.deepEqual(storedBindings(f.dir), bindings)
  } finally { await f.close() }
})

test('deleting a binding is idempotent and stops its events', async () => {
  const f = await fixture()
  try {
    assert.equal((await bind(f.port, 'openid_acme', { method: 'DELETE' })).status, 200)
    assert.deepEqual(storedBindings(f.dir), { schemaVersion: 1, bindings: { openid_beta: 'beta', openid_gone: 'gone' } })
    assert.equal((await bind(f.port, 'openid_acme', { method: 'DELETE' })).status, 200)
    const { raw, signature } = delivery('openid_acme')
    assert.equal((await post(f.port, raw, signature)).status, 200)
    assert.equal(f.tenant.requests.length, 0)
  } finally { await f.close() }
})
