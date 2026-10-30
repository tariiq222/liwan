// AC-01/02 isolation matrix: ten synthetic tenants (matching the authorized
// scratch databases liwan_shared_scratch_sharedgate20260928_t01..t10) exercised
// through the REAL guard edge and the REAL built shared-mode Nuxt server.
// Chain: client -> guard -> (Nuxt SSR | Odoo hop) -> guard internal hop ->
// synthetic tenant-aware upstream. 90 directional A->B pairs per surface.
//
// Boundaries: the upstream is synthetic (marker data), no real Odoo/ACL runs,
// no TLS/Caddy, no physical adapter. Browser hydration evidence lives in
// operational-ssr.test.mjs. This file proves the routing/session isolation
// layer only and authorizes nothing.
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, writeFile, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createGuard } from '../../deploy/shared/guard.mjs'

const root = new URL('../../', import.meta.url).pathname
const artifact = resolve(process.env.LIWAN_ACCEPTANCE_ARTIFACT ?? join(root, 'apps/web/.output'))
const SUFFIX = 'sharedgate20260928'
const tenants = Array.from({ length: 10 }, (_, i) => {
  const nn = String(i + 1).padStart(2, '0')
  return {
    host: `t${nn}.isolation-matrix.invalid`, tenantId: `t${nn}`,
    database: `liwan_shared_scratch_${SUFFIX}_t${nn}`, filestore: `liwan_shared_scratch_${SUFFIX}_t${nn}`,
    enabled: true, registryRevision: 1,
    uid: 101 + i, marker: `ISOLATION_T${nn}`, sid: `sid_t${nn}`, projectId: 5000 + i, taskId: 7000 + i, attachmentId: 9000 + i,
  }
})
const targetsOnly = list => list.map(({ uid, marker, sid, projectId, taskId, attachmentId, ...t }) => t)
const token = 'matrix-synthetic-proxy-token-00000000'
const keys = { test: 'matrix-synthetic-session-key-000000' }

test('ten-tenant guard+Nuxt isolation matrix rejects all 90 directional pairs per surface', { timeout: 240000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'liwan-isolation-matrix-'))
  const registry = join(directory, 'registry.json')
  await writeFile(registry, JSON.stringify({ schemaVersion: 1, snapshotRevision: 1, targets: targetsOnly(tenants) }))
  const calls = []
  const sockets = new Set()

  // Synthetic tenant-aware Odoo: trusts only the database name the guard
  // resolved (host header) and the raw per-tenant session id. Records every
  // dispatched call for the final leak audit.
  const mock = http.createServer((req, res) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      const tenant = tenants.find(t => t.database === req.headers.host)
      res.setHeader('content-type', 'application/json')
      if (!tenant) { res.writeHead(404); res.end('{}'); return }
      let body = {}
      try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { body = {} }
      if (req.method === 'POST' && req.url === '/web/session/authenticate') {
        calls.push({ path: req.url, host: req.headers.host, cookie: req.headers.cookie, proxyToken: req.headers['x-liwan-proxy-token'] })
        if (body.params?.db !== tenant.database) { res.writeHead(403); res.end('{}'); return }
        res.setHeader('set-cookie', `session_id=${tenant.sid}; Path=/; HttpOnly`)
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? null, result: { uid: tenant.uid, username: 'fixture', is_admin: true } }))
        return
      }
      if (req.url.startsWith('/api/v1/branding')) {
        calls.push({ path: req.url, host: req.headers.host, cookie: req.headers.cookie, proxyToken: req.headers['x-liwan-proxy-token'] })
        res.end(JSON.stringify({ name: tenant.marker, logo_url: '/fixture-logo.svg', primary_color: '#18181b', font: 'fixture' }))
        return
      }
      calls.push({ path: req.url, host: req.headers.host, cookie: req.headers.cookie, proxyToken: req.headers['x-liwan-proxy-token'] })
      if (req.headers.cookie !== `session_id=${tenant.sid}`) { res.writeHead(403); res.end('{}'); return }
      if (req.url === '/api/v1/me') {
        res.end(JSON.stringify({ id: tenant.uid, name: tenant.marker, login: tenant.marker, email: `${tenant.tenantId}@example.invalid`, lang: 'en', tz: 'UTC', role: 'employee', capabilities: ['pmo.projects.read'], entitlements: { 'pmo.enabled': true }, company: { id: tenant.uid, name: tenant.marker } }))
        return
      }
      if (req.url.startsWith('/api/v1/notifications')) { res.end(JSON.stringify({ items: [], total: 0 })); return }
      if (req.url.startsWith('/api/v1/projects?minimal=1')) { res.end(JSON.stringify([{ id: tenant.projectId, name: `PROJECT_${tenant.marker}` }])); return }
      const project = req.url.match(/^\/api\/v1\/projects\/(\d+)(?:\?|$)/)
      if (project) {
        if (Number(project[1]) !== tenant.projectId) { res.writeHead(404); res.end('{}'); return }
        res.end(JSON.stringify({ id: tenant.projectId, name: `PROJECT_${tenant.marker}` }))
        return
      }
      const content = req.url.match(/^\/api\/v1\/tasks\/(\d+)\/attachments\/(\d+)\/download$/)
      if (content) {
        if (Number(content[1]) !== tenant.taskId || Number(content[2]) !== tenant.attachmentId) { res.writeHead(404); res.end('{}'); return }
        res.setHeader('content-type', 'application/octet-stream')
        res.end(Buffer.from(`CONTENT_${tenant.marker}`))
        return
      }
      res.writeHead(404); res.end('{}')
    })
  })
  mock.on('connection', s => { sockets.add(s); s.once('close', () => sockets.delete(s)) })
  mock.on('upgrade', (req, socket) => {
    calls.push({ path: req.url, host: req.headers.host, cookie: req.headers.cookie, proxyToken: req.headers['x-liwan-proxy-token'] })
    const tenant = tenants.find(t => t.database === req.headers.host)
    if (!tenant || req.headers.cookie !== `session_id=${tenant.sid}`) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
    socket.on('data', chunk => socket.write(chunk))
    socket.on('error', () => {})
  })
  await new Promise(r => mock.listen(0, '127.0.0.1', r))
  const mockUrl = `http://127.0.0.1:${mock.address().port}`

  // Pre-allocate the guard port: Nuxt needs it as NUXT_ODOO_URL at spawn time.
  const reserve = net.createServer()
  await new Promise(r => reserve.listen(0, '127.0.0.1', r))
  const guardPort = reserve.address().port
  await new Promise(r => reserve.close(r))

  let child, exited, timer, stderr = ''
  try {
    child = spawn(process.execPath, ['--import', join(root, 'tools/shared_isolation_acceptance/t17-ssr-probe.mjs'), join(artifact, 'server/index.mjs')], { env: { PATH: process.env.PATH, NODE_ENV: 'production', LIWAN_TENANCY_MODE: 'shared', LIWAN_SHARED_PROXY_TOKEN: token, LIWAN_TENANT_REGISTRY_PATH: registry, NUXT_ODOO_URL: `http://127.0.0.1:${guardPort}`, T17_ALLOWED_PORT: String(guardPort) }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    child.stdout.resume(); child.stderr.on('data', c => { stderr += c })
    exited = once(child, 'exit')
    const address = await Promise.race([new Promise(r => child.on('message', m => m.bound && r(m.bound))), new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`startup_timeout: ${stderr}`)), 30000) }), exited.then(() => { throw Error(stderr) })])
    clearTimeout(timer)
    const nuxtPort = address.port
    // Bind the real guard: web hop to Nuxt, odoo hop to the synthetic upstream.
    const realGuard = createGuard({ registryPath: registry, proxyToken: token, keys, activeKid: 'test', odooUrl: mockUrl, webUrl: `http://127.0.0.1:${nuxtPort}` })
    await new Promise(r => realGuard.listen(guardPort, '127.0.0.1', r))
    try {
      const call = (method, path, headers, body) => new Promise((resolveRequest, reject) => {
        const req = http.request({ host: '127.0.0.1', port: guardPort, path, method, headers }, res => {
          let text = ''
          res.on('data', c => { text += c })
          res.on('end', () => resolveRequest({ status: res.statusCode, headers: res.headers, text }))
        })
        req.setTimeout(20000, () => req.destroy(Error('request_timeout')))
        req.on('error', reject)
        req.end(body)
      })
      const directToNuxt = (path, headers) => new Promise((resolveRequest, reject) => {
        const req = http.get({ host: '127.0.0.1', port: nuxtPort, path, headers }, res => {
          let text = ''
          res.on('data', c => { text += c })
          res.on('end', () => resolveRequest({ status: res.statusCode, text }))
        })
        req.setTimeout(10000, () => req.destroy(Error('request_timeout')))
        req.on('error', reject)
      })

      // Phase 1 — full login chain (client -> guard -> Nuxt BFF -> guard -> upstream) per tenant.
      const cookies = new Map()
      for (const tenant of tenants) {
        const result = await call('POST', '/api/auth/login', { host: tenant.host, 'content-type': 'application/json' }, JSON.stringify({ login: 'fixture', password: 'fixture-not-secret' }))
        assert.equal(result.status, 200, `login failed for ${tenant.tenantId}: ${result.text.slice(0, 300)}`)
        assert.equal(JSON.parse(result.text).ok, true)
        const cookie = (result.headers['set-cookie'] ?? []).map(c => c.split(';')[0]).find(c => c.startsWith('session_id='))
        assert.ok(cookie, `sealed session cookie missing for ${tenant.tenantId}`)
        assert.match(result.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Lax/)
        cookies.set(tenant, cookie)
      }
      console.log('Phase 1: 10/10 full-chain logins produced per-tenant sealed cookies')

      // Phase 2 — positive controls: own session on own host, API + SSR.
      for (const tenant of tenants) {
        const me = await call('GET', '/api/v1/me', { host: tenant.host, cookie: cookies.get(tenant) })
        assert.equal(me.status, 200, me.text.slice(0, 300))
        assert.ok(me.text.includes(tenant.marker), 'own identity missing')
        const search = await call('GET', '/search', { host: tenant.host, cookie: cookies.get(tenant) })
        assert.equal(search.status, 200, search.text.slice(0, 300))
        assert.ok(search.text.includes(`PROJECT_${tenant.marker}`), `own project missing from ${tenant.tenantId} SSR`)
        for (const other of tenants) if (other !== tenant) {
          assert.ok(!search.text.includes(other.marker), `foreign marker ${other.marker} leaked into ${tenant.tenantId} SSR`)
          assert.ok(!search.text.includes(`PROJECT_${other.marker}`), `foreign project leaked into ${tenant.tenantId} SSR`)
        }
        assert.ok(!search.text.includes(token), 'proxy token leaked into SSR response')
      }
      console.log('Phase 2: 10/10 positive controls (API identity + SSR project markup), zero foreign markers')

      // Phase 3 — 90 directional session crossings on the API surface, rejected before dispatch.
      const before = calls.length
      for (const a of tenants) for (const b of tenants) {
        if (a === b) continue
        const result = await call('GET', '/api/v1/me', { host: b.host, cookie: cookies.get(a) })
        assert.equal(result.status, 403, `A(${a.tenantId}) cookie on B(${b.tenantId}) host was not rejected`)
        assert.equal(result.text, 'tenant_boundary_rejected')
      }
      assert.equal(calls.length, before, 'a rejected crossing still dispatched upstream')

      // Phase 4 — 90 directional crossings on the SSR surface (web hop), rejected before Nuxt.
      for (const a of tenants) for (const b of tenants) {
        if (a === b) continue
        const result = await call('GET', '/search', { host: b.host, cookie: cookies.get(a) })
        assert.equal(result.status, 403, `A(${a.tenantId}) cookie on B(${b.tenantId}) SSR was not rejected`)
        assert.equal(result.text, 'tenant_boundary_rejected')
      }
      assert.equal(calls.length, before, 'a rejected SSR crossing dispatched upstream')
      console.log('Phases 3-4: 90+90 directional A->B session crossings rejected before dispatch on API and SSR surfaces')

      // Phase 5 — 90 object-id crossings with the OWN valid session of the target tenant.
      for (const a of tenants) for (const b of tenants) {
        if (a === b) continue
        const r1 = await call('GET', `/api/v1/projects/${a.projectId}`, { host: b.host, cookie: cookies.get(b) })
        assert.equal(r1.status, 404, `object id of A(${a.tenantId}) accepted on B(${b.tenantId})`)
        assert.ok(!r1.text.includes(a.marker))
        const r2 = await call('GET', `/api/v1/tasks/${a.taskId}/attachments/${a.attachmentId}/download`, { host: b.host, cookie: cookies.get(b) })
        assert.equal(r2.status, 404, `content id of A(${a.tenantId}) accepted on B(${b.tenantId})`)
        assert.ok(!r2.text.includes(a.marker))
      }
      // Own object ids still resolve.
      for (const tenant of tenants) {
        const r1 = await call('GET', `/api/v1/projects/${tenant.projectId}`, { host: tenant.host, cookie: cookies.get(tenant) })
        assert.equal(r1.status, 200)
        const r2 = await call('GET', `/api/v1/tasks/${tenant.taskId}/attachments/${tenant.attachmentId}/download`, { host: tenant.host, cookie: cookies.get(tenant) })
        assert.equal(r2.status, 200)
        assert.ok(r2.text.includes(`CONTENT_${tenant.marker}`))
      }
      console.log('Phase 5: 90+90 object-id crossings returned 404; 10/10 own objects resolved')

      // Phase 6 — unknown host, forged headers, direct-to-Nuxt bypass, stale internal binding.
      assert.equal((await call('GET', '/api/v1/me', { host: 'unknown.isolation-matrix.invalid', cookie: cookies.get(tenants[0]) })).status, 403)
      assert.equal((await call('GET', '/search', { host: 'unknown.isolation-matrix.invalid' })).status, 403)
      for (const header of ['x-odoo-database', 'x-openerp-session-id', 'x-forwarded-host', 'forwarded', 'x-liwan-proxy-token']) {
        const result = await call('GET', '/api/v1/me', { host: tenants[0].host, cookie: cookies.get(tenants[0]), [header]: 'forged' })
        assert.equal(result.status, 403, `forged ${header} accepted`)
        assert.equal(result.text, 'tenant_boundary_rejected')
      }
      const bypass = await directToNuxt('/search', { host: tenants[0].host, cookie: cookies.get(tenants[0]) })
      assert.equal(bypass.status, 403, 'direct Nuxt access without the guard was not rejected')
      const stale = await call('GET', '/api/v1/me', { host: tenants[0].host, 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '2' })
      assert.equal(stale.status, 403, 'stale internal revision accepted')
      assert.equal(stale.text, 'tenant_boundary_rejected')
      console.log('Phase 6: unknown host, forged routing headers, direct-Nuxt bypass and stale internal binding all rejected')

      // Phase 7 — websocket surface: own tenant upgrades, foreign cookie and foreign origin rejected.
      const ws = (tenant, cookie, origin) => new Promise((resolveWs, reject) => {
        const req = http.request({ host: '127.0.0.1', port: guardPort, path: '/websocket', method: 'GET', headers: { host: tenant.host, cookie, origin, connection: 'Upgrade', upgrade: 'websocket' } })
        req.on('upgrade', (reply, socket) => resolveWs({ upgraded: true, socket }))
        req.on('response', reply => { let text = ''; reply.on('data', c => { text += c }); reply.on('end', () => resolveWs({ upgraded: false, status: reply.statusCode })) })
        req.on('error', reject)
        req.end()
      })
      const own = await ws(tenants[0], cookies.get(tenants[0]), `https://${tenants[0].host}`)
      assert.ok(own.upgraded, 'own-tenant websocket upgrade rejected')
      await new Promise((resolveEcho, reject) => {
        own.socket.write('ping')
        own.socket.once('data', chunk => { assert.equal(chunk.toString(), 'ping'); own.socket.destroy(); resolveEcho() })
        own.socket.once('error', reject)
      })
      for (const b of [tenants[1], tenants[2]]) {
        const foreign = await ws(b, cookies.get(tenants[0]), `https://${b.host}`)
        assert.ok(!foreign.upgraded, `foreign cookie websocket on ${b.tenantId} upgraded`)
        assert.equal(foreign.status, 403)
      }
      const badOrigin = await ws(tenants[0], cookies.get(tenants[0]), 'https://evil.example')
      assert.ok(!badOrigin.upgraded, 'websocket with foreign origin upgraded')
      assert.equal(badOrigin.status, 403)
      console.log('Phase 7: websocket own upgrade + echo ok; foreign-cookie and foreign-origin handshakes rejected')

      // Phase 8 — registry publication barrier fails closed, then recovers.
      await writeFile(`${registry}.pending`, 'registry publication pending\n')
      const barrier = await call('GET', '/api/v1/me', { host: tenants[1].host, cookie: cookies.get(tenants[1]) })
      assert.equal(barrier.status, 403, 'pending publication marker did not fail closed')
      assert.equal(barrier.text, 'tenant_boundary_rejected')
      await unlink(`${registry}.pending`)
      const afterBarrier = await call('GET', '/api/v1/me', { host: tenants[1].host, cookie: cookies.get(tenants[1]) })
      assert.equal(afterBarrier.status, 200, 'recovery after barrier removal failed')

      // Phase 9 — fresh disable of one target: that tenant fails, neighbours unaffected.
      await writeFile(registry, JSON.stringify({ schemaVersion: 1, snapshotRevision: 2, targets: targetsOnly(tenants.map((t, i) => i === 4 ? { ...t, enabled: false, registryRevision: 2 } : t)) }))
      assert.equal((await call('GET', '/api/v1/branding', { host: tenants[4].host })).status, 403, 'disabled target still served')
      assert.equal((await call('GET', '/api/v1/me', { host: tenants[5].host, cookie: cookies.get(tenants[5]) })).status, 200, 'disable of t05 broke t06')
      await writeFile(registry, JSON.stringify({ schemaVersion: 1, snapshotRevision: 1, targets: targetsOnly(tenants) }))
      assert.equal((await call('GET', '/api/v1/me', { host: tenants[4].host, cookie: cookies.get(tenants[4]) })).status, 200, 'restore after re-enable failed')
      console.log('Phases 8-9: publication barrier failed closed then recovered; single-target disable isolated to that tenant')

      // Final audit — no dispatched call ever carried a foreign session or trusted headers.
      for (const c of calls) {
        const tenant = tenants.find(t => t.database === c.host)
        assert.ok(tenant, `upstream call to unknown database host ${c.host}`)
        assert.equal(c.proxyToken, undefined, `trusted proxy header reached the upstream on ${c.host}`)
        if (c.cookie) assert.equal(c.cookie, `session_id=${tenant.sid}`, `cross-tenant session reached upstream: ${JSON.stringify(c)}`)
      }
      console.log(`Isolation matrix complete: ${calls.length} upstream dispatches audited, zero foreign sessions, zero trusted-header leaks. Synthetic upstream; no real Odoo/ACL/TLS/Caddy claim.`)
    } finally {
      realGuard.closeAllConnections?.()
      await new Promise(r => realGuard.close(r))
    }
  } finally {
    clearTimeout(timer)
    if (child && child.exitCode === null) child.kill('SIGTERM')
    if (exited) await exited
    for (const socket of sockets) socket.destroy()
    await new Promise(r => mock.close(r))
    await rm(directory, { recursive: true, force: true })
  }
})
