import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { readAsset } from '../../apps/web/server/utils/releaseAssets.ts'
import { createGuard } from './guard.mjs'

const repository = fileURLToPath(new URL('../..', import.meta.url))
const token = 'synthetic-proxy-token-'.repeat(3)
const keys = { test: 'synthetic-session-key-'.repeat(3) }
const tenant = { host: 'tenant.example.test', tenantId: 'tenant_a', database: 'db_a', filestore: 'db_a', enabled: true, registryRevision: 1 }
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)))
const call = (url, path, method = 'GET') => new Promise((resolve, reject) => {
  const target = new URL(url)
  const request = http.request({ hostname: target.hostname, port: target.port, path, method, headers: { host: tenant.host } }, response => {
    const chunks = []; response.on('data', part => chunks.push(part)); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }))
  })
  request.on('error', reject); request.end()
})
function source(root, name, files) {
  const path = join(root, name); mkdirSync(path)
  for (const [filename, bytes] of Object.entries(files)) { const target = join(path, filename); mkdirSync(join(target, '..'), { recursive: true }); writeFileSync(target, bytes) }
  return path
}
function publish(publicDir, store, release) {
  const done = spawnSync('python3', ['-B', '-c', 'from deploy.releases.assets import publish_assets; import sys; publish_assets(*sys.argv[1:])', publicDir, store, release], { cwd: repository, encoding: 'utf8' })
  assert.equal(done.status, 0, 'asset publisher failed')
}
async function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'liwan-retained-assets-')))
  const store = join(root, 'assets')
  const first = source(root, 'first', { '_nuxt/Abc12345.js': 'old_chunk', '_nuxt/entry.Def67890.css': 'old_css', '_i18n/Abc12345/ar.json': '{"hello":"old"}', 'fonts/Arabic-Regular.woff2': 'font-bytes', 'fonts/LICENSE.txt': 'font-license', '_nuxt/builds/latest.json': '{"id":"blue-build"}', '_nuxt/builds/meta/11111111-1111-4111-8111-111111111111.json': '{"id":"old-meta"}' })
  const second = source(root, 'second', { '_nuxt/New12345.js': 'new_chunk', 'fonts/Arabic-Regular.woff2': 'font-bytes', 'fonts/LICENSE.txt': 'font-license', '_nuxt/builds/latest.json': '{"id":"green-build"}' })
  publish(first, store, 'release_blue'); publish(second, store, 'release_green')
  const calls = []
  const upstream = kind => http.createServer((request, response) => { calls.push({ kind, headers: request.headers }); if (['/_nuxt/builds/latest.json', '/fonts/LICENSE.txt'].includes(request.url)) { response.end(readFileSync(join(kind === 'blue' ? first : second, request.url))); return } response.end(kind) })
  const blue = upstream('blue'), green = upstream('green')
  const servers = [blue, green]
  t.after(() => { for (const server of servers) { server.closeAllConnections(); server.close() } })
  const blueUrl = await listen(blue), greenUrl = await listen(green)
  writeFileSync(join(root, 'registry.json'), JSON.stringify({ schemaVersion: 1, snapshotRevision: 1, targets: [tenant] }))
  writeFileSync(join(root, 'pools.json'), JSON.stringify({ schemaVersion: 1, pools: Object.fromEntries([['blue', blueUrl], ['green', greenUrl]].map(([id, url]) => [id, { poolId: id, releaseId: 'release_' + id, odooUrl: url, webUrl: url, wsUrl: url }])) }))
  const route = (poolId, revision) => ({ schemaVersion: 1, tenantId: tenant.tenantId, identityRevision: 1, routeRevision: revision, fence: revision, poolId, releaseId: 'release_' + poolId, state: 'serving' })
  writeFileSync(join(root, 'tenant_a.json'), JSON.stringify(route('blue', 1)))
  const guard = createGuard({ registryPath: join(root, 'registry.json'), proxyToken: token, keys, activeKid: 'test', odooUrl: blueUrl, webUrl: blueUrl, releaseRoutesDir: root, releaseAssetsDir: store })
  servers.push(guard)
  return { root, store, calls, url: await listen(guard), route }
}

test('published old chunks/css/i18n remain available after green routing without upstream business headers', async t => {
  const f = await fixture(t)
  assert.equal((await call(f.url, '/_nuxt/Abc12345.js')).body, 'old_chunk')
  writeFileSync(join(f.root, 'tenant_a.json'), JSON.stringify(f.route('green', 2)))
  for (const [path, bytes, mime] of [['/_nuxt/Abc12345.js', 'old_chunk', 'text/javascript'], ['/_nuxt/entry.Def67890.css', 'old_css', 'text/css'], ['/_i18n/Abc12345/ar.json', '{"hello":"old"}', 'application/json']]) {
    const response = await call(f.url, path)
    assert.equal(response.status, 200); assert.equal(response.body, bytes)
    assert.match(response.headers['content-type'], new RegExp('^' + mime))
    assert.match(response.headers['cache-control'], /immutable/)
    assert.equal(response.headers['x-liwan-proxy-token'], undefined)
    assert.equal(response.headers['set-cookie'], undefined)
  }
  assert.equal(f.calls.length, 0)
  assert.equal((await call(f.url, '/projects')).body, 'green')
  assert.equal(f.calls.length, 1)
  assert.equal((await call(f.url, '/_nuxt/Abc12345.js', 'HEAD')).body, '')
})

test('retained assets obey tenant maintenance and missing files never proxy to green', async t => {
  const f = await fixture(t)
  for (const path of ['/_nuxt/Missing1.js', '/_i18n/missing.json']) assert.equal((await call(f.url, path)).status, 404)
  writeFileSync(join(f.root, 'tenant_a.maintenance'), '{}')
  assert.equal((await call(f.url, '/_nuxt/Abc12345.js')).status, 503)
  assert.equal(f.calls.length, 0)
})

test('strict path aliases, traversal and symlinks return safe not-found; fonts revalidate', async t => {
  const f = await fixture(t)
  for (const path of ['/_nuxt/../secret.js', '/_nuxt/%41bc12345.js', '/_nuxt//Abc12345.js', '/%5fnuxt/Abc12345.js']) {
    assert.equal((await call(f.url, path)).status, 404)
  }
  symlinkSync('/etc/passwd', join(f.store, '_nuxt', 'Bad12345.js'))
  assert.equal(readAsset(f.store, '/_nuxt/Bad12345.js'), null)
  const font = await call(f.url, '/fonts/Arabic-Regular.woff2')
  assert.equal(font.body, 'font-bytes'); assert.doesNotMatch(font.headers['cache-control'], /immutable/)
  assert.equal(f.calls.length, 0)
})

test('old unique Nuxt build metadata survives cutover while latest and font license reach selected web', async t => {
  const f = await fixture(t)
  assert.equal((await call(f.url, '/_nuxt/builds/latest.json')).body, '{"id":"blue-build"}')
  writeFileSync(join(f.root, 'tenant_a.json'), JSON.stringify(f.route('green', 2)))
  const metadata = await call(f.url, '/_nuxt/builds/meta/11111111-1111-4111-8111-111111111111.json')
  assert.equal(metadata.status, 200); assert.equal(metadata.body, '{"id":"old-meta"}')
  assert.match(metadata.headers['cache-control'], /immutable/)
  const latest = await call(f.url, '/_nuxt/builds/latest.json')
  assert.equal(latest.status, 200); assert.equal(latest.body, '{"id":"green-build"}')
  assert.equal(f.calls.at(-1).kind, 'green')
  assert.equal((await call(f.url, '/fonts/LICENSE.txt')).body, 'font-license')
  assert.equal((await call(f.url, '/_nuxt/builds/%6catest.json')).status, 404)
})
