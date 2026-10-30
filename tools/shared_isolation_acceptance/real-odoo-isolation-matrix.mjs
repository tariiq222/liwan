// Real-Odoo AC-01/02 isolation matrix: ten REAL tenant Odoo databases behind
// dbfilter (^%h$), exercised through the REAL guard edge (deploy/shared/guard.mjs).
//
// Difference from tools/shared_isolation_acceptance/isolation-matrix.test.mjs:
// that file proves the guard+Nuxt routing/session layer against a SYNTHETIC
// marker-data upstream. This file replaces the synthetic upstream with ONE
// live Odoo process serving all ten tenant databases via `dbfilter = ^%h$`
// (the documented shared-mode mechanism in deploy/shared/odoo.conf), with
// real ACLs, real sessions, and real liwan_api/liwan_pmo controllers. It proves
// (or disproves) the explicit "Real Odoo ACLs are not proven" gap recorded in
// docs/verification/shared-isolation-matrix.md.
//
// The Nuxt/SSR hop is NOT exercised here (scoped out by explicit user
// decision): the guard's webUrl points at an API relay stub that models the
// authenticated internal return hop and 404s non-API requests. SSR markup isolation is already
// covered by the existing synthetic-upstream matrix and is not re-proven here.
//
// Boundaries still open after this file: no TLS/Caddy, no physical fenced
// adapter, no MFA, single node, no concurrent production load, no SSR markup
// crossing against real Odoo-rendered pages.
import http from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, writeFile, rm, unlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createGuard } from '../../deploy/shared/guard.mjs'

const root = new URL('../../', import.meta.url).pathname

// Stock addons, the LiwanOS addons and the pinned OCA repositories (deploy/oca-addons.json), verified at their pins.
function addonsPath() {
  const oca = spawnSync('python3', ['-B', join(root, 'tools/oca_addons.py'), 'path', '--check'], { cwd: root, encoding: 'utf8' })
  if (oca.status !== 0) throw new Error(`pinned OCA addons are not ready: ${oca.stderr}`)
  return `${ODOO_ROOT}/addons,${root}odoo-addons,${oca.stdout.trim()}`
}
const ODOO_ROOT = process.env.LIWAN_ODOO_ROOT || '/Users/tariq/code/odoo'
const PG_HOST = process.env.LIWAN_PG_HOST || '127.0.0.1'
const PG_USER = process.env.LIWAN_PG_USER || 'odoo'
const PG_PASSWORD = process.env.LIWAN_PG_PASSWORD || 'odoo'
const SUFFIX = process.env.LIWAN_DRILL_SUFFIX || 'realiso20261009'
const N_TENANTS = 10

const tenants = Array.from({ length: N_TENANTS }, (_, i) => {
  const nn = String(i + 1).padStart(2, '0')
  const db = `liwan_scratch_${SUFFIX}_t${nn}`
  return {
    host: `t${nn}.real-isolation-matrix.invalid`, tenantId: `t${nn}`,
    database: db, filestore: db, enabled: true, registryRevision: 1,
    login: `drill_admin_${nn}`, password: 'liwan-real-iso-2026',
    marker: `REALISO_T${nn}`,
  }
})
const targetsOnly = list => list.map(({ login, password, marker, ...t }) => t)
const token = 'real-isolation-proxy-token-0000000000000'
const keys = { test: 'real-isolation-session-key-00000000000' }

function run(argv, opts = {}) {
  const { input, ...spawnOpts } = opts
  return new Promise((resolvePromise, reject) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: [input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'], ...spawnOpts })
    let out = '', err = ''
    child.stdout.on('data', c => { out += c })
    child.stderr.on('data', c => { err += c })
    child.on('exit', code => code === 0 ? resolvePromise({ out, err }) : reject(new Error(`${argv.join(' ')} failed (${code}): ${err.slice(-4000)}`)))
    child.on('error', reject)
    if (input !== undefined) { child.stdin.write(input); child.stdin.end() }
  })
}

async function dropdb(name) {
  const env = { ...process.env, PGPASSWORD: PG_PASSWORD }
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await run(['dropdb', '-h', PG_HOST, '-U', PG_USER, '--if-exists', name], { env })
      return
    } catch (error) {
      if (attempt === 5) { console.error(`dropdb ${name} failed after 5 attempts: ${error.message}`); return }
      await new Promise(r => setTimeout(r, 1000))
    }
  }
}

async function installTenant(cfg, tenant, dataDir, modules) {
  await dropdb(tenant.database)
  const classificationPath = join(dataDir, `classification-${tenant.tenantId}.json`)
  await run([process.execPath !== undefined ? 'python3' : 'python3', '-B', join(root, 'deploy/classification.py'), 'fixture',
    '--database', tenant.database, '--mode', 'non_saas', '--output', classificationPath], { cwd: root })
  await run([
    join(ODOO_ROOT, '.venv/bin/python'), join(ODOO_ROOT, 'odoo-bin'),
    '--db_host', PG_HOST, '--db_user', PG_USER, '--db_password', PG_PASSWORD,
    '--addons-path', addonsPath(),
    '--data-dir', dataDir, '-d', tenant.database, '-i', modules,
    '--without-demo=all', '--http-port', '0', '--workers=0', '--max-cron-threads=0', '--stop-after-init',
  ], { env: { ...process.env, PGPASSWORD: PG_PASSWORD, LIWAN_COMMERCIAL_CONFIG: classificationPath }, cwd: root })

  // Seed a unique per-tenant admin user, a project, and a task-linked attachment via shell.
  const seed = `
import base64
login = ${JSON.stringify(tenant.login)}
password = ${JSON.stringify(tenant.password)}
marker = ${JSON.stringify(tenant.marker)}
registry = env["liwan.feature.registry"]  # noqa: F821
env["liwan.tenant.profile"]._liwan_initialize_legacy_policy(registry._liwan_installed_module_ids())  # noqa: F821
env.cr.commit()  # noqa: F821
Users = env["res.users"].with_context(no_reset_password=True)  # noqa: F821
employee_group = env.ref("liwan_core.group_employee")  # noqa: F821
manager_group = env.ref("liwan_pmo.group_pmo_manager")  # noqa: F821
user = Users.search([("login", "=", login)], limit=1)
vals = {"name": f"Drill Admin {marker}", "login": login, "password": password,
        "group_ids": [(6, 0, [employee_group.id, manager_group.id])]}
if not user:
    user = Users.create(vals)
else:
    user.write(vals)
env["hr.employee"].create({"name": vals["name"], "user_id": user.id}) if not env["hr.employee"].search([("user_id", "=", user.id)]) else None
project = env["project.project"].create({"name": f"PROJECT_{marker}"})  # noqa: F821
task = env["project.task"].create({"name": f"TASK_{marker}", "project_id": project.id, "user_ids": [(6, 0, [user.id])]})  # noqa: F821
attachment = env["ir.attachment"].create({"name": f"content-{marker}.bin", "res_model": "project.task", "res_id": task.id, "datas": base64.b64encode(f"CONTENT_{marker}".encode())})  # noqa: F821
env.cr.commit()  # noqa: F821
print("SEED_OK", task.id, project.id, attachment.id)  # noqa: T201
`
  const { out } = await run([join(ODOO_ROOT, '.venv/bin/python'), join(ODOO_ROOT, 'odoo-bin'), 'shell',
    '--db_host', PG_HOST, '--db_user', PG_USER, '--db_password', PG_PASSWORD,
    '--addons-path', addonsPath(),
    '--data-dir', dataDir, '-d', tenant.database, '--no-http', '--log-level=warn'],
    { env: { ...process.env, PGPASSWORD: PG_PASSWORD }, input: seed, cwd: root })
  const match = out.match(/SEED_OK (\d+) (\d+) (\d+)/)
  if (!match) throw new Error(`seed did not report ids for ${tenant.tenantId}: ${out.slice(-2000)}`)
  return { taskId: Number(match[1]), projectId: Number(match[2]), attachmentId: Number(match[3]) }
}

test('real-Odoo ten-tenant isolation matrix: dbfilter-selected live Odoo behind the real guard', { timeout: 20 * 60 * 1000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'liwan-real-isolation-'))
  const dataDir = join(directory, 'data')
  await mkdir(dataDir, { recursive: true })
  const registry = join(directory, 'registry.json')

  // node:test's t.after() runs hooks in REGISTRATION order (confirmed empirically: a
  // separately-registered dropdb hook ran to completion across all ten tenants, each
  // retrying for 5s, BEFORE a hook registered later ever killed the Odoo process holding
  // those connections open). A single ordered teardown avoids relying on multi-hook ordering.
  const resources = { guard: null, webStub: null, odooProc: null, odooExited: null }
  t.after(async () => {
    if (resources.guard) { resources.guard.closeAllConnections?.(); await new Promise(r => resources.guard.close(r)) }
    if (resources.webStub) { resources.webStub.closeAllConnections?.(); await new Promise(r => resources.webStub.close(r)) }
    if (resources.odooProc && resources.odooProc.exitCode === null) {
      resources.odooProc.kill('SIGTERM')
      const timer = setTimeout(() => { if (resources.odooProc.exitCode === null) resources.odooProc.kill('SIGKILL') }, 10000)
      await resources.odooExited
      clearTimeout(timer)
    }
    for (const tenant of tenants) await dropdb(tenant.database)
    await rm(directory, { recursive: true, force: true })
  })

  const modulesResult = await run(['python3', '-B', 'tools/catalog_check.py', '--release-modules'], { cwd: root })
  const modules = modulesResult.out.trim()

  console.log(`Installing ${N_TENANTS} real tenant databases with [${modules}]...`)
  const seeded = new Map()
  for (const tenant of tenants) {
    const ids = await installTenant({}, tenant, dataDir, modules)
    seeded.set(tenant.tenantId, ids)
    process.stdout.write(`  ${tenant.tenantId} ready (project=${ids.projectId}, attachment=${ids.attachmentId})\n`)
  }

  await writeFile(registry, JSON.stringify({ schemaVersion: 1, snapshotRevision: 1, targets: targetsOnly(tenants) }))

  // ONE live Odoo process serves all ten tenant databases via dbfilter = ^%h$.
  const odooPort = await new Promise((resolvePort) => {
    const probe = http.createServer()
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolvePort(port)) })
  })
  const odooConfPath = join(directory, 'odoo.conf')
  await writeFile(odooConfPath, [
    '[options]', `data_dir = ${dataDir}`, `db_host = ${PG_HOST}`, `db_user = ${PG_USER}`, `db_password = ${PG_PASSWORD}`,
    'dbfilter = ^%h$', 'list_db = False', `http_port = ${odooPort}`, 'workers = 0', 'max_cron_threads = 0',
  ].join('\n') + '\n')

  const odooProc = spawn(join(ODOO_ROOT, '.venv/bin/python'), [join(ODOO_ROOT, 'odoo-bin'), '-c', odooConfPath,
    '--addons-path', addonsPath()],
    { env: { ...process.env, PGPASSWORD: PG_PASSWORD }, stdio: ['ignore', 'pipe', 'pipe'] })
  let odooLog = ''
  odooProc.stdout.on('data', c => { odooLog += c })
  odooProc.stderr.on('data', c => { odooLog += c })
  resources.odooProc = odooProc
  resources.odooExited = once(odooProc, 'exit')

  // Minimal web-hop stub models the authenticated internal API return hop;
  // SSR markup is explicitly out of scope for this drill (see header comment).
  const webStub = http.createServer((req, res) => {
    if (!req.url.startsWith('/api/v1/')) { res.writeHead(404); res.end('ssr_not_covered_by_real_odoo_drill'); return }
    // Preserve the signed cookie and authenticated internal headers for the
    // return guard hop. This drill does not claim Nuxt session admission.
    const upstream = http.request({ hostname: '127.0.0.1', port: guardPort, path: req.url, method: req.method, headers: req.headers }, reply => {
      res.writeHead(reply.statusCode, reply.headers); reply.pipe(res)
    })
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
    req.pipe(upstream)
  })
  await new Promise(r => webStub.listen(0, '127.0.0.1', r))
  const webPort = webStub.address().port
  resources.webStub = webStub

  // Wait for Odoo health on an arbitrary tenant host.
  const waitHealthy = async () => {
    const deadline = Date.now() + 120000
    while (Date.now() < deadline) {
      try {
        const ok = await new Promise((resolveReq) => {
          const req = http.get({ host: '127.0.0.1', port: odooPort, path: '/web/health', headers: { host: tenants[0].database } }, res => { res.resume(); resolveReq(res.statusCode === 200) })
          req.on('error', () => resolveReq(false))
        })
        if (ok) return
      } catch { /* retry */ }
      await new Promise(r => setTimeout(r, 1000))
    }
    throw new Error(`Odoo did not become healthy: ${odooLog.slice(-4000)}`)
  }
  await waitHealthy()
  console.log('Live Odoo process healthy, serving all 10 tenant databases via dbfilter')

  const guard = createGuard({ registryPath: registry, proxyToken: token, keys, activeKid: 'test', odooUrl: `http://127.0.0.1:${odooPort}`, webUrl: `http://127.0.0.1:${webPort}` })
  const guardPort = await new Promise((resolvePort) => { guard.listen(0, '127.0.0.1', () => resolvePort(guard.address().port)) })
  resources.guard = guard

  const call = (method, path, headers, body) => new Promise((resolveRequest, reject) => {
    const req = http.request({ host: '127.0.0.1', port: guardPort, path, method, headers }, res => {
      let text = ''
      res.on('data', c => { text += c })
      res.on('end', () => resolveRequest({ status: res.statusCode, headers: res.headers, text }))
    })
    req.setTimeout(20000, () => req.destroy(new Error('request_timeout')))
    req.on('error', reject)
    req.end(body)
  })

  // Phase 1: login chain mirroring apps/web/server/api/auth/login.post.ts (which this
  // drill does not run — SSR/Nuxt BFF is explicitly out of scope). We call the guard's
  // internal /web/session/authenticate path with the real proxy token, exactly as the
  // real Nuxt BFF would, then seal the resulting real Odoo session_id the same way the
  // guard does for every other hop (the guard itself performs the sealing on the
  // response path for ALL odoo-routed calls, so this already exercises real sealing).
  const cookies = new Map()
  for (const tenant of tenants) {
    const result = await call('POST', '/web/session/authenticate',
      { host: tenant.host, 'content-type': 'application/json', 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '1' },
      JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { db: tenant.database, login: tenant.login, password: tenant.password } }))
    assert.equal(result.status, 200, `login failed for ${tenant.tenantId}: ${result.text.slice(0, 500)}`)
    const body = JSON.parse(result.text)
    assert.ok(body.result?.uid, `no uid in authenticate response for ${tenant.tenantId}: ${result.text.slice(0, 300)}`)
    const cookie = (result.headers['set-cookie'] ?? []).map(c => c.split(';')[0]).find(c => c.startsWith('session_id='))
    assert.ok(cookie, `sealed session cookie missing for ${tenant.tenantId}: ${result.text.slice(0, 300)}`)
    assert.match(result.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Lax/, 'cookie not sealed with the real guard envelope')
    cookies.set(tenant.tenantId, cookie)
  }
  console.log(`Phase 1: ${N_TENANTS}/${N_TENANTS} full-chain logins against REAL Odoo produced sealed per-tenant cookies`)

  // Phase 2: positive controls — own session, own identity, own project/attachment, via real liwan_api.
  for (const tenant of tenants) {
    const me = await call('GET', '/api/v1/me', { host: tenant.host, cookie: cookies.get(tenant.tenantId) })
    assert.equal(me.status, 200, me.text.slice(0, 300))
    assert.ok(me.text.includes(tenant.marker), `own identity missing for ${tenant.tenantId}: ${me.text.slice(0, 300)}`)
    const ids = seeded.get(tenant.tenantId)
    const project = await call('GET', `/api/v1/projects/${ids.projectId}`, { host: tenant.host, cookie: cookies.get(tenant.tenantId) })
    assert.equal(project.status, 200, project.text.slice(0, 300))
    assert.ok(project.text.includes(tenant.marker))
  }
  console.log(`Phase 2: ${N_TENANTS}/${N_TENANTS} positive controls passed against REAL Odoo (/api/v1/me, /api/v1/projects/:id)`)

  // Phase 3: 90 directional A->B session crossings on real /api/v1/me — real Odoo ACL/session must reject.
  let crossingResults = []
  for (const a of tenants) for (const b of tenants) {
    if (a === b) continue
    const result = await call('GET', '/api/v1/me', { host: b.host, cookie: cookies.get(a.tenantId) })
    crossingResults.push({ a: a.tenantId, b: b.tenantId, status: result.status, bodySnippet: result.text.slice(0, 200) })
  }
  const failedCrossings = crossingResults.filter(r => r.status === 200)
  assert.equal(failedCrossings.length, 0, `${failedCrossings.length} cross-tenant session(s) were NOT rejected by real Odoo: ${JSON.stringify(failedCrossings.slice(0, 5))}`)
  console.log(`Phase 3: 90/90 directional A->B session crossings on /api/v1/me rejected by REAL Odoo+guard (statuses: ${[...new Set(crossingResults.map(r => r.status))]})`)

  // Phase 4: 90+90 object-id crossings — A's project/attachment id requested on B's host with B's OWN valid session.
  // Postgres sequences restart at 1 per fresh database, so aIds.projectId/attachmentId numerically
  // equal B's own ids in this single-tenant-per-db setup; the record is therefore reachable by id
  // (database scoping, not a 404), and the real question is whether the RETURNED DATA is B's own
  // record (correctly scoped) or a leak of A's content. A's marker in the response is the leak signal.
  const objectCrossings = []
  for (const a of tenants) for (const b of tenants) {
    if (a === b) continue
    const aIds = seeded.get(a.tenantId)
    const r1 = await call('GET', `/api/v1/projects/${aIds.projectId}`, { host: b.host, cookie: cookies.get(b.tenantId) })
    const leaked1 = r1.status === 200 && r1.text.includes(a.marker)
    objectCrossings.push({ surface: 'project', a: a.tenantId, b: b.tenantId, status: r1.status, leaked: leaked1, servedOwn: r1.status === 200 && r1.text.includes(b.marker) })
    const r2 = await call('GET', `/api/v1/tasks/${aIds.taskId}/attachments/${aIds.attachmentId}/download`, { host: b.host, cookie: cookies.get(b.tenantId) })
    const leaked2 = r2.status === 200 && r2.text.includes(a.marker)
    objectCrossings.push({ surface: 'content', a: a.tenantId, b: b.tenantId, status: r2.status, leaked: leaked2, servedOwn: r2.status === 200 && r2.text.includes(b.marker) })
  }
  const leakedObjects = objectCrossings.filter(r => r.leaked)
  assert.equal(leakedObjects.length, 0, `object-id crossings leaked A's data into B's response: ${JSON.stringify(leakedObjects.slice(0, 5))}`)
  const notScoped = objectCrossings.filter(r => r.status === 200 && !r.servedOwn)
  assert.equal(notScoped.length, 0, `object id resolved but served neither A's nor B's data (unexpected): ${JSON.stringify(notScoped.slice(0, 5))}`)
  console.log(`Phase 4: ${objectCrossings.length} object-id crossings (project + attachment) against REAL Odoo ACLs: zero cross-tenant leaks, every 200 correctly served B's OWN database-scoped record (statuses: ${[...new Set(objectCrossings.map(r => r.status))]})`)

  // Own objects still resolve (content route is Odoo-ACL gated, not guard-gated).
  for (const tenant of tenants) {
    const ids = seeded.get(tenant.tenantId)
    const r = await call('GET', `/api/v1/tasks/${ids.taskId}/attachments/${ids.attachmentId}/download`, { host: tenant.host, cookie: cookies.get(tenant.tenantId) })
    assert.equal(r.status, 200, `own attachment failed to resolve for ${tenant.tenantId}: ${r.text.slice(0, 200)}`)
    assert.ok(r.text.includes(tenant.marker))
  }
  console.log(`Phase 5: ${N_TENANTS}/${N_TENANTS} own attachments resolved correctly through real Odoo ir.binary ACL`)

  // Phase 6: WebSocket upgrade through the real guard to the real Odoo bus, own vs foreign session.
  const ws = (tenant, cookie, origin) => new Promise((resolveWs, reject) => {
    const req = http.request({ host: '127.0.0.1', port: guardPort, path: '/websocket', method: 'GET',
      headers: { host: tenant.host, cookie, origin, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13' } })
    req.on('upgrade', (reply, socket) => resolveWs({ upgraded: true, status: reply.statusCode, socket }))
    req.on('response', reply => { let text = ''; reply.on('data', c => { text += c }); reply.on('end', () => resolveWs({ upgraded: false, status: reply.statusCode, text })) })
    req.on('error', reject)
    req.end()
  })
  const own = await ws(tenants[0], cookies.get(tenants[0].tenantId), `https://${tenants[0].host}`)
  const foreign = await ws(tenants[1], cookies.get(tenants[0].tenantId), `https://${tenants[1].host}`)
  if (own.upgraded) own.socket.destroy()
  if (foreign.upgraded) foreign.socket.destroy()
  assert.ok(!foreign.upgraded, `foreign-session websocket upgrade on real Odoo bus was accepted (status ${foreign.status})`)
  console.log(`Phase 6: websocket — own-tenant upgrade=${own.upgraded} (status ${own.status}), foreign-session rejected=${!foreign.upgraded} (status ${foreign.status})`)

  const report = {
    timestamp_utc: new Date().toISOString(),
    tenants: N_TENANTS,
    modules_installed: modules,
    phase1_logins: cookies.size,
    phase3_session_crossings: { total: crossingResults.length, rejected: crossingResults.length - failedCrossings.length, failed: failedCrossings },
    phase4_object_crossings: { total: objectCrossings.length, rejected: objectCrossings.length - leakedObjects.length, leaked: leakedObjects, statuses: [...new Set(objectCrossings.map(r => r.status))] },
    phase6_websocket: { own_upgraded: own.upgraded, foreign_upgraded: foreign.upgraded },
    not_covered: ['SSR/Nuxt markup crossing against real Odoo pages (scoped out)', 'TLS/Caddy', 'physical fenced adapter', 'MFA', 'multi-node', 'concurrent production load'],
  }
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2))
  const outPath = process.env.LIWAN_REAL_ISOLATION_REPORT
  if (outPath) await writeFile(outPath, JSON.stringify(report, null, 2))
  console.log('REAL_ISOLATION_REPORT=' + JSON.stringify(report))
})
