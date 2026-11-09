import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionCodec, createGuard } from './guard.mjs'
import { DOCUMENT_SECURITY_HEADERS, DEFAULT_ONLY_HEADERS, applyDocumentHeaders } from './securityHeaders.mjs'

const targets = Array.from({ length: 3 }, (_, i) => ({ host: `t${i}.example.test`, tenantId: `tenant_${i}`, database: `db_${i}`, filestore: `db_${i}`, enabled: true, registryRevision: 1 }))
const registry = { schemaVersion: 1, snapshotRevision: 1, targets }
const token = 'synthetic-proxy-marker-'.repeat(3)
const keys = { test: 'synthetic-signing-marker-'.repeat(3) }
const codec = sessionCodec(keys, 'test')
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)))
const call = (url, path, headers) => new Promise((resolve, reject) => {
  const r = http.request(new URL(path, url), { headers }, res => { let text = ''; res.on('data', b => { text += b }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text })) })
  r.setTimeout(2000, () => r.destroy(Error('test_timeout'))); r.on('error', reject); r.end()
})

test('a Nuxt document carries every shared-edge security header', async t => {
  const root = mkdtempSync(join(tmpdir(), 'liwan-guard-headers-'))
  const path = join(root, 'registry.json')
  writeFileSync(path, JSON.stringify(registry))
  const backend = http.createServer((req, res) => {
    // The app answers a document; the guard adds the headers the edge owns.
    res.setHeader('content-type', 'text/html; charset=utf-8')
    if (req.url === '/pay/token') res.setHeader('referrer-policy', 'no-referrer')
    res.end('<html></html>')
  })
  const upstream = await listen(backend)
  const guard = createGuard({ registryPath: path, proxyToken: token, keys, activeKid: 'test', odooUrl: upstream, webUrl: upstream })
  const url = await listen(guard)
  t.after(() => { guard.closeAllConnections(); guard.close(); backend.closeAllConnections(); backend.close() })
  const headers = { host: targets[0].host }

  const page = await call(url, '/projects', headers)
  assert.equal(page.status, 200)
  for (const [name, value] of Object.entries(DOCUMENT_SECURITY_HEADERS)) {
    if (DEFAULT_ONLY_HEADERS.has(name)) continue
    assert.equal(page.headers[name], value, name)
  }
  assert.equal(page.headers['referrer-policy'], 'strict-origin-when-cross-origin')

  // A page that carries a document token sets a stricter policy itself; the edge keeps it.
  const tokenPage = await call(url, '/pay/token', headers)
  assert.equal(tokenPage.headers['referrer-policy'], 'no-referrer')
})

test('an Odoo answer carries none of the document headers', async t => {
  const root = mkdtempSync(join(tmpdir(), 'liwan-guard-headers-odoo-'))
  const path = join(root, 'registry.json')
  writeFileSync(path, JSON.stringify(registry))
  const backend = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{}') })
  const upstream = await listen(backend)
  const guard = createGuard({ registryPath: path, proxyToken: token, keys, activeKid: 'test', odooUrl: upstream, webUrl: upstream })
  const url = await listen(guard)
  t.after(() => { guard.closeAllConnections(); guard.close(); backend.closeAllConnections(); backend.close() })

  // An internal API call is the Odoo hop: a document CSP there would break its callers.
  const api = await call(url, '/api/v1/me', {
    host: targets[0].host, 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '1',
    cookie: 'session_id=' + codec.seal('sid', targets[0]),
  })
  assert.equal(api.status, 200)
  for (const name of Object.keys(DOCUMENT_SECURITY_HEADERS)) {
    assert.equal(api.headers[name], undefined, name)
  }
})

test('the header set is the dedicated edge set, and a default never overrides the app', () => {
  // A fixed header wins over an upstream value, like `defer` on the dedicated edge.
  const applied = applyDocumentHeaders({ 'content-security-policy': 'upstream-policy', 'x-frame-options': 'SAMEORIGIN' })
  assert.equal(applied['content-security-policy'], DOCUMENT_SECURITY_HEADERS['content-security-policy'])
  assert.equal(applied['x-frame-options'], 'DENY')
  // A default-only header keeps what the app sent.
  assert.equal(applyDocumentHeaders({ 'referrer-policy': 'no-referrer' })['referrer-policy'], 'no-referrer')
  // And the shared set is not silently narrowed: every document header the dedicated edge sets is here.
  assert.deepEqual(new Set(Object.keys(DOCUMENT_SECURITY_HEADERS)), new Set([
    'content-security-policy', 'referrer-policy', 'strict-transport-security',
    'x-content-type-options', 'x-frame-options', 'permissions-policy',
  ]))
})

test('the guard image carries every module guard.mjs imports', () => {
  // The image copies an explicit list, so a new relative import that is not listed builds
  // an image whose guard cannot start. Read the import lines, not a hand-kept copy of them.
  const read = path => readFileSync(path, 'utf8')
  const dockerfile = read('deploy/shared/Dockerfile')
  const imports = [...read('deploy/shared/guard.mjs').matchAll(/^import .* from '\.\/([^']+)'/gm)].map(m => m[1])
  assert.ok(imports.length > 0)
  for (const name of imports) {
    assert.ok(dockerfile.includes(`deploy/shared/${name}`), `Dockerfile does not copy deploy/shared/${name}`)
  }
})
