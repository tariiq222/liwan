import http from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { writeFileSync, readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
const root = new URL('../../', import.meta.url).pathname
const artifact = process.env.T20_ARTIFACT ?? root + 'apps/web/.output-t16-shared/'
const token = 't17-synthetic-private-token-1234567890'
const registryPath = new URL('./t17-registry.json', import.meta.url).pathname
const tenant = { host: 't17.acceptance.test', tenantId: 't17', database: 'synthetic_t17', filestore: 'synthetic_t17', enabled: true, registryRevision: 1 }
writeFileSync(registryPath, JSON.stringify({ schemaVersion: 1, snapshotRevision: 1, targets: [tenant] }))
const calls = [], sockets = new Set()
const mock = http.createServer((req, res) => {
  calls.push({ control: req.headers['x-test-control'] === '1', path: req.url, host: req.headers.host, token: req.headers['x-nasq-proxy-token'], revision: req.headers['x-nasq-tenant-revision'] })
  res.setHeader('content-type', 'application/json')
  if (process.env.T17_STRICT_HOST === '1' && req.headers.host !== tenant.host) { res.statusCode = 403; res.end('{"code":"tenant_boundary_rejected","message":"wrong host"}'); return }
  if (!req.headers['x-test-control'] && (req.headers['x-nasq-proxy-token'] !== token || req.headers['x-nasq-tenant-revision'] !== '1')) { res.statusCode = 403; res.end('{}'); return }
  if (req.url === '/web/session/authenticate') { res.setHeader('set-cookie', ['session_id=synthetic_mfa; Path=/; HttpOnly', 'test_second=2; Path=/']); res.end('{"result":{"uid":null}}'); return }
  if (req.url === '/api/v1/auth/totp') { res.setHeader('set-cookie', ['session_id=synthetic_valid; Path=/', 'test_second=3; Path=/']); res.end('{"ok":true}'); return }
  if (req.url === '/web/session/destroy') { if (req.headers.cookie?.includes('fail')) { res.statusCode = 500; res.end('{"error":"synthetic"}') } else res.end('{"result":true}'); return }
  if (req.url === '/api/v1/oversized') { res.end(Buffer.alloc(33 * 1024 * 1024, 65)); return }
  if (req.url === '/api/v1/timeout') return
  if (req.url === '/api/v1/redirect') { res.statusCode = 302; res.setHeader('location', 'http://external.invalid/'); res.end(); return }
  if (req.url === '/api/v1/binary') { res.setHeader('content-type', 'application/octet-stream'); res.setHeader('set-cookie', ['a=1; Path=/', 'b=2; Path=/']); res.end(Buffer.from([0,1,255,128])); return }
  if (req.url === '/api/v1/me') { res.statusCode = 403; res.end('{"code":"forbidden","message":"synthetic anonymous"}') }
  else if (req.url === '/api/v1/branding') res.end(JSON.stringify({ name: 'T17 Synthetic Brand', logo_url: '/web/binary/company_logo?company=1&v=0-e3b0c44298fc', primary_color: '#18181b', font: 'test' }))
  else { res.statusCode = 404; res.end('{}') }
})
mock.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)) })
await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve))
const port = mock.address().port
let child, exited, timeout, stderr = ''
try {
  child = spawn(process.execPath, ['--import', new URL('./t17-ssr-probe.mjs', import.meta.url).pathname, artifact + 'server/index.mjs'], { env: { PATH: process.env.PATH, NODE_ENV: 'production', NASQ_TENANCY_MODE: 'shared', NASQ_SHARED_PROXY_TOKEN: token, NASQ_TENANT_REGISTRY_PATH: registryPath, NUXT_ODOO_URL: `http://127.0.0.1:${port}`, T17_ALLOWED_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  exited = once(child, 'exit'); child.stderr.on('data', c => stderr += c)
  const address = await Promise.race([new Promise(resolve => child.on('message', m => m.bound && resolve(m.bound))), new Promise((_, reject) => timeout = setTimeout(() => reject(Error('startup_timeout')), 15000)), exited.then(() => { throw Error(stderr) })])
  const response = await new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: address.port, path: '/login', headers: { host: tenant.host, 'x-nasq-proxy-token': token, 'x-nasq-tenant-revision': '1' }, timeout: 10000 }, res => { let text = ''; res.on('data', c => text += c); res.on('end', () => resolve({ status: res.statusCode, text })) })
    req.on('error', reject); req.on('timeout', () => req.destroy(Error('request_timeout')))
  })
  const appRequest = (path, method = 'GET', body, cookie = '') => new Promise((resolve, reject) => {
    const q = http.request({ host: '127.0.0.1', port: address.port, path, method, headers: { host: tenant.host, 'x-nasq-proxy-token': token, 'x-nasq-tenant-revision': '1', 'content-type': 'application/json', cookie }, timeout: 20000 }, r => { const chunks = []; r.on('data', c => chunks.push(c)); r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(chunks), cookies: r.headers['set-cookie'] ?? [] })) }); q.on('error', reject); q.on('timeout', () => q.destroy(Error('timeout'))); q.end(body)
  })
  const login = await appRequest('/api/auth/login', 'POST', '{"login":"synthetic","password":"synthetic"}')
  assert.equal(login.status, 200); assert.equal(JSON.parse(login.body).mfa, 'totp'); assert.equal(login.cookies.length, 2)
  const totp = await appRequest('/api/auth/totp', 'POST', '{"code":"123456"}', 'session_id=synthetic_mfa')
  assert.equal(totp.status, 200); assert.equal(totp.cookies.length, 2)
  const logoutFailure = await appRequest('/api/auth/logout', 'POST', '{}', 'session_id=fail')
  assert.equal(logoutFailure.status, 502)
  const logout = await appRequest('/api/auth/logout', 'POST', '{}', 'session_id=synthetic_valid'); assert.equal(logout.status, 204)
  const redirect = await appRequest('/api/v1/redirect'); assert.equal(redirect.status, 502); assert.ok(!redirect.body.includes(token))
  const oversized = await appRequest('/api/v1/oversized'); assert.equal(oversized.status, 502); assert.ok(!oversized.body.includes(token))
  const timeoutStart = Date.now(); const timed = await appRequest('/api/v1/timeout'); assert.equal(timed.status, 502); assert.ok(Date.now() - timeoutStart >= 14000)
  console.log(JSON.stringify({ oversizedResponse: oversized.status, deadlineResponse: timed.status, deadlineMs: Date.now() - timeoutStart }))
  const binary = await appRequest('/api/v1/binary'); assert.equal(binary.status, 200); assert.deepEqual(binary.body, Buffer.from([0,1,255,128])); assert.equal(binary.cookies.length, 2)
  const head = await appRequest('/api/v1/binary', 'HEAD'); assert.equal(head.status, 200); assert.equal(head.body.length, 0)
  console.log(JSON.stringify({ loginMFA: login.status, totp: totp.status, logoutFailure: logoutFailure.status, logout: logout.status, redirectRejected: redirect.status, binaryExact: true, multipleCookies: true, headEmpty: true }))
  const direct = await new Promise((resolve, reject) => { const q = http.get({ host: '127.0.0.1', port: address.port, path: '/api/v1/branding', headers: { host: tenant.host, 'x-nasq-proxy-token': token, 'x-nasq-tenant-revision': '1' } }, r => { r.resume(); r.on('end', () => resolve(r.statusCode)) }); q.on('error', reject) })
  const nodeFetch = await fetch(`http://127.0.0.1:${port}/api/v1/branding`, { headers: { host: tenant.host, 'x-test-control': '1' } }); await nodeFetch.text()
  const httpControl = await new Promise((resolve, reject) => { const q = http.get({ host: '127.0.0.1', port, path: '/api/v1/branding', headers: { host: tenant.host, 'x-test-control': '1' } }, r => { r.resume(); r.on('end', () => resolve(r.statusCode)) }); q.on('error', reject) })
  assert.equal(httpControl, 200)
  let files = 0
  function scan(dir) { for (const item of readdirSync(dir, { withFileTypes: true })) { const path = dir + '/' + item.name; if (item.isDirectory()) scan(path); else { files++; const body = readFileSync(path); assert.ok(!body.includes(token)); assert.ok(!body.includes('NASQ_SHARED_PROXY_TOKEN')) } } }
  scan(artifact + 'public')
  assert.ok(!response.text.includes(token)); assert.ok(!response.text.includes('x-nasq-proxy-token'))
  console.log(JSON.stringify({ status: response.status, directAPIStatus: direct, nodeFetchStatus: nodeFetch.status, httpHostControlStatus: httpControl, brandedHTML: response.text.includes('T17 Synthetic Brand'), privateTokenInHTML: false, publicFilesScanned: files, calls: calls.map(c => ({ ...c, token: c.token === token ? 'MATCH' : 'MISSING' })), stderr }))
  assert.equal(response.status, 200)
  assert.ok(response.text.includes('T17 Synthetic Brand'))
  assert.ok(!response.text.includes(token)); assert.ok(!response.text.includes('x-nasq-proxy-token'))
  assert.ok(calls.some(c => c.path === '/api/v1/me')); assert.ok(calls.some(c => c.path === '/api/v1/branding'))
  for (const call of calls.filter(c => !c.control)) { assert.equal(call.host, tenant.host); assert.equal(call.token, token); assert.equal(call.revision, '1') }
  console.log(JSON.stringify({ builtSSR: 'login/useFetch positive, synthetic anonymous upstream', privateTokenInHTML: false, publicFilesScanned: files }))
} finally {
  clearTimeout(timeout)
  if (child && child.exitCode === null) child.kill('SIGTERM')
  if (exited) await exited
  for (const socket of sockets) socket.destroy()
  await new Promise(resolve => mock.close(resolve))
  console.log('T17_SSR_CHILD_AND_MOCK_CLOSED')
}
