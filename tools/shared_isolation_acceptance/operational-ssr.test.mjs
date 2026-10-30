import http from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromium } from '@playwright/test'

const root = new URL('../../', import.meta.url).pathname
const artifact = resolve(process.env.LIWAN_ACCEPTANCE_ARTIFACT ?? join(root, 'apps/web/.output'))
test('built authenticated SSR separates concurrent and alternating tenant payloads', { timeout: 45000 }, async () => {
  const token = 'operational-synthetic-private-token-0000000'
  const tenants = ['a', 'b'].map((id, index) => ({ host: `${id}.operational.invalid`, tenantId: id, database: `synthetic_${id}`, filestore: `synthetic_${id}`, enabled: true, registryRevision: 1, uid: 101 + index, marker: `TENANT_${id.toUpperCase()}_ONLY` }))
  const directory = await mkdtemp(join(tmpdir(), 'liwan-operational-ssr-'))
  const registry = join(directory, 'registry.json')
  await writeFile(registry, JSON.stringify({ schemaVersion: 1, snapshotRevision: 1, targets: tenants.map(({ uid, marker, ...target }) => target) }))
  const revokedProjects = new Set()
  let notifyAbortSeen, notifyAbortClosed
  const abortSeen = new Promise(resolve => { notifyAbortSeen = resolve })
  const abortClosed = new Promise(resolve => { notifyAbortClosed = resolve })
  const calls = [], sockets = new Set()
  const mock = http.createServer((req, res) => {
    const tenant = tenants.find(t => t.host === req.headers.host)
    res.setHeader('content-type', 'application/json')
    if (!tenant || req.headers['x-liwan-proxy-token'] !== token || req.headers['x-liwan-tenant-revision'] !== '1') { res.writeHead(403); res.end('{}'); return }
    calls.push({ path: req.url, host: req.headers.host, cookie: req.headers.cookie, token: req.headers['x-liwan-proxy-token'], revision: req.headers['x-liwan-tenant-revision'] })
    if (req.url === '/api/v1/abort-probe') { res.once('close', notifyAbortClosed); notifyAbortSeen(); return }
    if (req.url === '/api/v1/partial') {
      if (req.headers.range !== 'bytes=1-2') { res.writeHead(416); res.end(); return }
      res.writeHead(206, { 'content-type': 'application/octet-stream', 'content-range': 'bytes 1-2/4', 'content-disposition': 'attachment; filename="fixture.bin"', 'connection': 'x-private-hop', 'x-private-hop': 'must-not-forward' }); res.end(Buffer.from([1, 255])); return
    }
    if (req.url === '/api/v1/unchanged') { res.writeHead(304, { etag: '"fixture"' }); res.end(); return }
    if (req.url === '/api/v1/projects?minimal=1') {
      if (req.headers.cookie !== `session_id=${tenant.tenantId}`) { res.writeHead(403); res.end('{}'); return }
      res.end(JSON.stringify([{ id: tenant.uid, name: `PROJECT_${tenant.marker}` }])); return
    }
    if (req.url === '/api/v1/me') {
      if (req.headers.cookie !== `session_id=${tenant.tenantId}`) { res.writeHead(403); res.end('{}'); return }
      res.end(JSON.stringify({ id: tenant.uid, name: tenant.marker, login: tenant.marker, email: `${tenant.tenantId}@example.invalid`, lang: 'en', tz: 'UTC', role: 'employee', capabilities: ['pmo.projects.read'], entitlements: { 'pmo.enabled': !revokedProjects.has(tenant.tenantId) }, company: { id: tenant.uid, name: tenant.marker } }))
    } else if (req.url === '/api/v1/branding') res.end(JSON.stringify({ name: tenant.marker, logo_url: '/fixture-logo.svg', primary_color: '#18181b', font: 'test' }))
    else { res.writeHead(404); res.end('{}') }
  })
  mock.on('connection', s => { sockets.add(s); s.once('close', () => sockets.delete(s)) })
  await new Promise(r => mock.listen(0, '127.0.0.1', r))
  let child, exited, timer, stderr = ''
  try {
    child = spawn(process.execPath, ['--import', join(root, 'tools/shared_isolation_acceptance/t17-ssr-probe.mjs'), join(artifact, 'server/index.mjs')], { env: { PATH: process.env.PATH, NODE_ENV: 'production', LIWAN_TENANCY_MODE: 'shared', LIWAN_SHARED_PROXY_TOKEN: token, LIWAN_TENANT_REGISTRY_PATH: registry, NUXT_ODOO_URL: `http://127.0.0.1:${mock.address().port}`, T17_ALLOWED_PORT: String(mock.address().port) }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    child.stdout.resume(); child.stderr.on('data', c => { stderr += c })
    exited = once(child, 'exit')
    const address = await Promise.race([new Promise(r => child.on('message', m => m.bound && r(m.bound))), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('startup_timeout')), 15000) }), exited.then(() => { throw Error(stderr) })])
    clearTimeout(timer)
    const request = (tenant, path = '/account', extraHeaders = {}) => new Promise((resolveRequest, reject) => {
      const req = http.get({ host: '127.0.0.1', port: address.port, path, headers: { ...extraHeaders, host: tenant.host, cookie: `session_id=${tenant.tenantId}`, 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '1' }, timeout: 10000 }, res => { let text = ''; res.on('data', c => { text += c }); res.on('end', () => resolveRequest({ status: res.statusCode, text, headers: res.headers })) })
      req.on('error', reject); req.on('timeout', () => req.destroy(Error('request_timeout')))
    })
    const verify = (response, tenant) => {
      assert.equal(response.status, 200, response.text.slice(0, 500))
      assert.ok(response.text.includes(tenant.marker), 'own authenticated identity missing')
      assert.ok(!response.text.includes(tenants.find(t => t !== tenant).marker), 'foreign identity leaked')
      const payload = response.text.match(/<script[^>]+id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1]
      assert.ok(payload?.includes(tenant.marker), 'own identity missing from serialized payload')
      assert.ok(!response.text.includes(token)); assert.ok(!response.text.includes('x-liwan-proxy-token'))
    }
    await Promise.all(Array.from({ length: 12 }, async (_, i) => { const tenant = tenants[i % 2]; verify(await request(tenant), tenant) }))
    for (let i = 0; i < 6; i++) for (const tenant of tenants) verify(await request(tenant), tenant)
    const verifyQuery = (response, tenant) => {
      verify(response, tenant)
      const payload = response.text.match(/<script[^>]+id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1]
      assert.ok(payload?.includes(`PROJECT_${tenant.marker}`), 'query-specific project missing from SSR payload')
      const markup = response.text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      assert.ok(markup.includes(`PROJECT_${tenant.marker}`), 'query-specific project missing from rendered HTML')
    }
    await Promise.all(Array.from({length:12}, async (_,i) => {
      const tenant=tenants[i%2];verifyQuery(await request(tenant,'/search'),tenant)
    }))
    for(let i=0;i<3;i++)for(const tenant of tenants)verifyQuery(await request(tenant,'/search'),tenant)
    for(const tenant of tenants)assert.ok(calls.some(c=>c.path==='/api/v1/projects?minimal=1'&&c.host===tenant.host&&c.cookie===`session_id=${tenant.tenantId}`))
    for (const tenant of tenants) assert.ok(calls.some(c => c.path === '/api/v1/me' && c.host === tenant.host && c.cookie === `session_id=${tenant.tenantId}`))
    const browser = await chromium.launch({ headless: true })
    try {
      const context = await browser.newContext()
      const page = await context.newPage()
      const visits = []
      const browserErrors = []
      page.on('pageerror', error => browserErrors.push(error.message))
      page.on('console', message => { if (/hydration.*mismatch/i.test(message.text())) browserErrors.push(message.text()) })
      await page.route('**/*', async route => {
        const url = new URL(route.request().url())
        if (!url.hostname.endsWith('.operational.invalid')) return route.abort()
        const tenant = tenants.find(t => t.host === url.hostname)
        const headers = { ...route.request().headers(), 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '1' }
        if (tenant) headers.cookie = `session_id=${tenant.tenantId}`
        visits.push({ host: url.hostname, path: url.pathname, cookie: headers.cookie })
        try {
          const response = await context.request.fetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, { method: route.request().method(), headers: { ...headers, host: url.hostname } })
          const body = await response.body()
          await route.fulfill({ status: response.status(), headers: response.headers(), body })
        } catch (error) {
          if (!/disposed|Target closed|intercept/i.test(String(error))) throw error
        }
      })
      for (const tenant of [...tenants, tenants[0]]) {
        await page.goto(`http://${tenant.host}/search`)
        await page.getByTestId('search-page').waitFor({ timeout: 5000 })
        await page.getByText(`PROJECT_${tenant.marker}`).waitFor()
        assert.ok(!(await page.locator('body').innerText()).includes(`PROJECT_${tenants.find(t => t !== tenant).marker}`), 'foreign project visible after hydration')
        assert.ok(!(await page.content()).includes(`PROJECT_${tenants.find(t => t !== tenant).marker}`), 'foreign project in hydrated DOM')
        await page.goto(`http://${tenant.host}/account`)
        await page.getByText(tenant.marker).first().waitFor()
        await page.locator('a[href="/projects"]').first().click()
        await page.waitForURL(`http://${tenant.host}/projects`)
        await page.getByText(tenant.marker).first().waitFor()
        assert.ok(!(await page.locator('body').innerText()).includes(tenants.find(t => t !== tenant).marker), 'foreign identity visible after client navigation')
      }
      for (const tenant of tenants) {
        assert.ok(visits.some(v => v.host === tenant.host && v.path === '/search' && v.cookie === `session_id=${tenant.tenantId}`))
        assert.ok(visits.some(v => v.host === tenant.host && v.path === '/api/v1/me' && v.cookie === `session_id=${tenant.tenantId}`), 'client navigation must fetch tenant-bound identity')
      }
      assert.deepEqual(browserErrors, [], 'browser hydration errors')
      console.log('Browser: A→B→A full navigation hydrated project markers and client account→projects navigation; no foreign visible markers. Synthetic network interception; no same-origin session swap or real Odoo proof.')
      await context.close()
    } finally { await browser.close() }
    for (const call of calls.filter(c => c.path === '/api/v1/projects?minimal=1')) {
      assert.equal(call.token, token)
      assert.equal(call.revision, '1')
    }
    const projectCallsA = () => calls.filter(c => c.path === '/api/v1/projects?minimal=1' && c.host === tenants[0].host).length
    const beforeRevocation = projectCallsA()
    revokedProjects.add('a')
    const [revoked, stillAllowed] = await Promise.all(tenants.map(t => request(t, '/search')))
    verify(revoked, tenants[0])
    assert.ok(!revoked.text.includes(`PROJECT_${tenants[0].marker}`), 'revoked request reused prior query data')
    assert.equal(projectCallsA(), beforeRevocation, 'disabled query still reached upstream')
    verifyQuery(stillAllowed, tenants[1])
    const aborted = http.get({ host: '127.0.0.1', port: address.port, path: '/api/v1/abort-probe', headers: { host: tenants[0].host, cookie: 'session_id=a', 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '1' } })
    aborted.on('error', () => {})
    await abortSeen
    aborted.destroy()
    let abortTimer
    try { await Promise.race([abortClosed, new Promise((_, reject) => { abortTimer = setTimeout(() => reject(Error('upstream_abort_not_observed')), 3000) })]) }
    finally { clearTimeout(abortTimer) }
    verify(await request(tenants[1]), tenants[1])
    const oversized = await new Promise((resolveUpload, reject) => {
      const req = http.request({ host: '127.0.0.1', port: address.port, method: 'POST', path: '/api/v1/upload-probe', headers: { host: tenants[0].host, cookie: 'session_id=a', 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '1', 'content-type': 'application/json' }, timeout: 10000 }, res => { res.resume(); res.on('end', () => resolveUpload(res.statusCode)) })
      req.on('error', reject); req.on('timeout', () => req.destroy(Error('upload_timeout')))
      req.end(Buffer.alloc(16 * 1024 * 1024 + 1, 65))
    })
    assert.equal(oversized, 413)
    assert.equal(calls.filter(c => c.path === '/api/v1/upload-probe').length, 0)
    verify(await request(tenants[1]), tenants[1])
    const slowStarted = Date.now()
    const slowOutcome = await new Promise(resolveSlow => {
      let finished = false
      let drip, deadline
      const finish = value => { if (finished) return; finished = true; clearInterval(drip); clearTimeout(deadline); resolveSlow(value) }
      const req = http.request({ host: '127.0.0.1', port: address.port, method: 'POST', path: '/api/v1/slow-upload', headers: { host: tenants[0].host, cookie: 'session_id=a', 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '1', 'content-type': 'application/json' } }, res => { res.resume(); res.on('end', () => finish(`status:${res.statusCode}`)) })
      req.on('error', error => finish(error.code ?? error.message))
      req.write('{')
      drip = setInterval(() => req.write(' '), 1000)
      deadline = setTimeout(() => { finish('client_safety_timeout'); req.destroy() }, 20000)
    })
    assert.notEqual(slowOutcome, 'client_safety_timeout')
    assert.ok(Date.now() - slowStarted >= 14000, `upload ended too early: ${slowOutcome}`)
    assert.ok(Date.now() - slowStarted < 20000)
    assert.equal(calls.filter(c => c.path === '/api/v1/slow-upload').length, 0)
    verify(await request(tenants[1]), tenants[1])
    console.log(`Built slow-upload total deadline enforced: ${slowOutcome}`)
    const partial = await request(tenants[0], '/api/v1/partial', { range: 'bytes=1-2' })
    assert.equal(partial.status, 206)
    assert.equal(partial.headers['content-range'], 'bytes 1-2/4')
    assert.equal(partial.headers['content-disposition'], 'attachment; filename="fixture.bin"')
    assert.equal(partial.headers['x-private-hop'], undefined)
    const unchanged = await request(tenants[1], '/api/v1/unchanged', { 'if-none-match': '"fixture"' })
    assert.equal(unchanged.status, 304); assert.equal(unchanged.text, ''); assert.equal(unchanged.headers.etag, '"fixture"')
    console.log('SSR: 24 initial /account identity checks; 18 /search useApi+Vue Query markup/payload checks, then A entitlement revocation versus allowed B. Synthetic upstream; browser hydration above is intercepted and does not prove same-origin session switching or real Odoo.')
  } finally {
    clearTimeout(timer)
    if (child && child.exitCode === null) child.kill('SIGTERM')
    if (exited) await exited
    for (const socket of sockets) socket.destroy()
    await new Promise(r => mock.close(r))
  }
})
