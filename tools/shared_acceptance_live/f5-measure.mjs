// r3: real Chromium traffic with one session per tenant and raw HTTPS bypass probes.
import { chromium } from '@playwright/test'
import https from 'node:https'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const dir = dirname(fileURLToPath(import.meta.url))
const state = Object.fromEntries(readFileSync(resolve(dir, '.state'), 'utf8').trim().split('\n').map(line => {
  const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).replace(/^'|'$/g, '')]
}))
const ca = readFileSync(resolve(state.TMPDIR_BASE, 'root.crt'))
const outdir = resolve(dir, 'test-results/r3')
mkdirSync(outdir, { recursive: true })
function request(host, path, method = 'GET', payload = null, cookie = '') {
  return new Promise((done, reject) => {
    const body = payload === null ? null : JSON.stringify(payload)
    const req = https.request({ hostname: '127.0.0.1', servername: host, port: 443, path, method, ca,
      rejectUnauthorized: true, headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) } }, res => {
      let text = ''; res.on('data', c => text += c); res.on('end', () => done({ status: res.statusCode, headers: res.headers, text }))
    })
    req.on('error', reject); req.setTimeout(15000, () => req.destroy(new Error('HTTPS timeout')))
    req.end(body)
  })
}
const classify = path => path === '/web/session/get_session_info' ? 'get_session_info'
  : path.startsWith('/web/image/') ? 'web_image'
  : path === '/web/binary/company_logo' ? 'company_logo'
  : path.startsWith('/api/v1/') ? 'api_v1'
  : path.startsWith('/_nuxt/') ? 'nuxt' : 'other'
const result = { date: new Date().toISOString(), project: state.PROJECT_NAME, client: 'one loopback client IP',
  sessionsPerTenant: 1, loads: [], auth: [], bypass: [] }
const save = () => writeFileSync(resolve(outdir, 'f5-results.json'), JSON.stringify(result, null, 2))
const browser = await chromium.launch({ args: ['--no-proxy-server', '--host-resolver-rules=MAP a.accept.nasq.test 127.0.0.1, MAP b.accept.nasq.test 127.0.0.1'] })
try {
  const tenants = []
  for (const name of ['a', 'b']) {
    const host = `${name}.accept.nasq.test`
    const auth = await request(host, '/api/auth/login', 'POST', {
      login: `admin@${host}`, password: readFileSync(resolve(state.TMPDIR_BASE, `admin_${name}_password`), 'utf8').trim() })
    if (auth.status !== 200) throw new Error(`Session setup ${name}: HTTP ${auth.status}`)
    const raw = (auth.headers['set-cookie'] || []).filter(c => c.startsWith('session_id=')).at(-1)
    if (!raw) throw new Error(`Session setup ${name}: no session cookie`)
    const value = raw.split(';')[0].slice('session_id='.length)
    const context = await browser.newContext({ locale: 'ar-SA', ignoreHTTPSErrors: true })
    await context.addCookies([{ name: 'session_id', value, domain: host, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }])
    const page = await context.newPage()
    tenants.push({ name, host, context, page, cookie: `session_id=${value}`, current: null })
    page.on('request', r => {
      const t = tenants.find(t => t.page === page)
      if (!t?.current || !r.url().includes('.accept.nasq.test')) return
      const path = new URL(r.url()).pathname
      t.current.requests.push({ path, method: r.method(), class: classify(path), status: null })
    })
    page.on('response', r => {
      const t = tenants.find(t => t.page === page)
      if (!t?.current || !r.url().includes('.accept.nasq.test')) return
      const path = new URL(r.url()).pathname
      const item = t.current.requests.find(x => x.path === path && x.method === r.request().method() && x.status === null)
      if (item) item.status = r.status()
    })
  }
  // Raw path preserved by node:https (no URL dot-segment normalization).
  // Probe before draining the window, so a later auth 429 cannot mask the denial.
  for (const t of tenants) for (const path of ['/web/session/get_session_info/../authenticate', '/WEB/session/get_session_info', '/web%2Fsession%2Fget_session_info']) {
    const r = await request(t.host, path, 'GET', null, t.cookie)
    result.bypass.push({ tenant: t.name.toUpperCase(), path, status: r.status,
      noCredentialAccess: r.status === 403 || r.status === 404 || r.status === 405,
      bodyClass: r.text.includes('tenant_boundary_rejected') ? 'tenant_boundary_rejected' : r.text.includes('route_not_allowed') ? 'route_not_allowed' : 'other (body not logged)' })
  }
  save()
  // Drain all preceding proof/login traffic, retaining these same authenticated sessions.
  console.log('Session setup complete; draining auth window for 65 seconds.')
  await new Promise(r => setTimeout(r, 65000))
  const start = Date.now()
  for (let i = 0; i < 15; i++) {
    await Promise.all(tenants.map(async t => {
      const path = ['/', '/projects', '/hr'][i % 3]
      const load = { tenant: t.name.toUpperCase(), path, startedMs: Date.now() - start, requests: [] }
      t.current = load
      const response = await t.page.goto(`https://${t.host}${path}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
      load.documentStatus = response.status()
      await t.page.waitForLoadState('networkidle', { timeout: 15000 })
      const body = await t.page.locator('body').innerText()
      load.markerPresent = body.includes(`ACCEPT-${t.name.toUpperCase()}-${path === '/hr' ? 'EMP' : 'ONLY'}`)
      load.otherMarkerAbsent = !body.includes(`ACCEPT-${t.name === 'a' ? 'B' : 'A'}-`)
      load.authenticated = !new URL(t.page.url()).pathname.startsWith('/login')
      load.elapsedMs = Date.now() - start - load.startedMs
      load.avatarRequests = load.requests.filter(x => x.path.startsWith('/web/image/') && /\/(res\.users|hr\.employee|res\.partner)\//.test(x.path)).length
      load.logoRequests = load.requests.filter(x => x.path === '/web/binary/company_logo' || (x.path.startsWith('/web/image/') && /\/(res\.company)\//.test(x.path))).length
      load.faviconRequests = load.requests.filter(x => x.path === '/favicon.ico').length
      result.loads.push(load); t.current = null; save()
    }))
  }
  result.loadDurationMs = Date.now() - start
  // Immediately after the 30 loads; no bypass or other auth traffic intervenes.
  result.authStartedAfterLoadsMs = Date.now() - start - result.loadDurationMs
  for (let i = 1; i <= 25; i++) {
    const r = await request(tenants[0].host, '/api/auth/login', 'POST', { login: 'wrong@invalid.test', password: 'invalid-test-value' })
    result.auth.push({ attempt: i, status: r.status })
  }
  result.authFirst429 = result.auth.find(x => x.status === 429)?.attempt ?? null
  result.classes = {}
  for (const l of result.loads) for (const r of l.requests) {
    const counts = result.classes[r.class] ||= {}; counts[r.status ?? 'unresolved'] = (counts[r.status ?? 'unresolved'] || 0) + 1
  }
  result.passed = result.loads.length === 30 && result.loadDurationMs < 60000 && result.loads.every(l => l.authenticated && l.markerPresent && l.otherMarkerAbsent)
    && result.loads.every(l => l.requests.filter(r => ['get_session_info', 'web_image', 'company_logo'].includes(r.class)).every(r => r.status !== 429))
    && result.authFirst429 === 21 && result.bypass.every(r => r.noCredentialAccess)
  save()
  console.log(JSON.stringify({ loadCount: result.loads.length, durationMs: result.loadDurationMs, classes: result.classes,
    avatars: result.loads.map(l => l.avatarRequests), logos: result.loads.map(l => l.logoRequests), favicon: result.loads.map(l => l.faviconRequests),
    auth: result.auth, bypass: result.bypass, passed: result.passed }, null, 2))
  if (!result.passed) process.exitCode = 1
} finally { save(); await browser.close() }
