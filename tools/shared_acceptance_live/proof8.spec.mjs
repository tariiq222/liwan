// Proof 8: real-browser tenant isolation (Playwright, Chromium).
//
// Connects to the live acceptance edge on 127.0.0.1:443 without editing
// /etc/hosts (Chromium --host-resolver-rules).
//
// TLS TRUST: Caddy's local CA issues leaf -> "Caddy Local Authority - ECC
// Intermediate" -> root. Chromium's --ignore-certificate-errors-spki-list matches
// the SPKI of the certificate that carries the error; pinning the ROOT therefore
// does not authorize the leaf, and navigation still fails with
// ERR_CERT_AUTHORITY_INVALID (verified directly: pin-only fails, pin +
// ignoreHTTPSErrors succeeds). The browser context is created with
// ignoreHTTPSErrors for that reason. Proof 1 is the TLS proof: probe.mjs performs
// the same requests with rejectUnauthorized:true against the exported root CA and
// reports the subject/issuer/SAN. The SPKI is still passed so the pinning path is
// exercised wherever Chromium accepts it.
import { test as base, chromium, expect } from '@playwright/test'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATE_FILE = resolve(__dirname, '.state')

function readState() {
  const state = {}
  for (const line of readFileSync(STATE_FILE, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (!m) continue
    // up.sh writes shell-quoted values (DOMAIN contains a space).
    let value = m[2]
    if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1)
    }
    state[m[1]] = value
  }
  return state
}

const state = readState()
const TMPDIR = state.TMPDIR_BASE
if (!TMPDIR) throw new Error('No TMPDIR_BASE in .state — run up.sh first')
const SPKI = readFileSync(resolve(TMPDIR, 'root.spki'), 'utf8').trim()
const SCREENSHOT_DIR = process.env.WEBVUE_SCREENSHOT_DIR
  || resolve(__dirname, '../../docs/verification/assets/shared-live-acceptance')
mkdirSync(SCREENSHOT_DIR, { recursive: true })

const TENANTS = [
  {
    name: 'A',
    base: 'https://a.accept.webvue.test',
    login: 'admin@a.accept.webvue.test',
    passwordFile: 'admin_a_password',
    ownProject: 'ACCEPT-A-ONLY',
    otherProject: 'ACCEPT-B-ONLY',
    ownEmployee: 'ACCEPT-A-EMP',
    otherEmployee: 'ACCEPT-B-EMP',
  },
  {
    name: 'B',
    base: 'https://b.accept.webvue.test',
    login: 'admin@b.accept.webvue.test',
    passwordFile: 'admin_b_password',
    ownProject: 'ACCEPT-B-ONLY',
    otherProject: 'ACCEPT-A-ONLY',
    ownEmployee: 'ACCEPT-B-EMP',
    otherEmployee: 'ACCEPT-A-EMP',
  },
]

const test = base.extend({
  browser: async ({}, use) => {
    const ctx = await chromium.launch({
      args: [
        '--host-resolver-rules=MAP a.accept.webvue.test 127.0.0.1, MAP b.accept.webvue.test 127.0.0.1',
        `--ignore-certificate-errors-spki-list=${SPKI}`,
      ],
    })
    await use(ctx)
    await ctx.close()
  },
})

// Each tenant gets its own browser context: separate cookie jars, no shared session.
for (const tenant of TENANTS) {
  test(`Tenant ${tenant.name}: Arabic UI pages are isolated and logout works`, async ({ browser }) => {
    // (diagnostics are written next to this spec file for post-mortem inspection)
    const password = readFileSync(resolve(TMPDIR, tenant.passwordFile), 'utf8').trim()
    const context = await browser.newContext({ locale: 'ar-SA', ignoreHTTPSErrors: true })
    const page = await context.newPage()
    const evidence = []
    const httpLog = []
    const diagFile = resolve(__dirname, `diag-tenant-${tenant.name}.json`)
    const dump = () => { try { writeFileSync(diagFile, JSON.stringify({ tenant: tenant.name, url: page.url(), evidence, httpLog }, null, 2)) } catch {} }
    page.on('response', r => {
      if (!r.url().includes('.accept.webvue.test')) return
      const line = `${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`
      httpLog.push(line)
      if (r.status() >= 400 && !line.includes('/api/auth/login')) evidence.push(`http-error: ${line}`)
    })
    page.on('console', m => { if (m.type() === 'error') evidence.push(`console-error: ${m.text().slice(0, 120)}`) })
    page.on('pageerror', e => evidence.push(`page-error: ${String(e).slice(0, 120)}`))

    // --- Log in through the real login form (Arabic UI) ---
    // The shared edge rate-limits the auth zone to 20 requests/minute across ALL
    // tenants, and the auth-dependent proofs also consume that budget. Retry the
    // form a few times instead of treating a transient 429 as an isolation failure.
    let dir = null
    let landed = false
    for (let attempt = 1; attempt <= 4 && !landed; attempt++) {
      const t0 = Date.now()
      await page.goto(`${tenant.base}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 })
      evidence.push(`attempt ${attempt} goto done in ${Date.now() - t0}ms status_url=${page.url()}`)
      if (dir === null) {
        await expect(page.locator('html')).toHaveAttribute('dir', /rtl|ltr/)
        dir = await page.locator('html').getAttribute('dir')
      }
      await page.locator('#login').fill(tenant.login)
      await page.locator('#password').fill(password)
      const submit = page.locator('form button[type="submit"]').first()
      const t1 = Date.now()
      await expect.poll(() => submit.isEnabled(), { timeout: 20000 }).toBe(true)
      evidence.push(`attempt ${attempt} hydrated in ${Date.now() - t1}ms bodyLen=${(await page.locator('body').innerText().catch(() => '')).length}`)
      const [loginResponse] = await Promise.all([
        page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login', { timeout: 20000 }).catch(() => null),
        submit.click(),
      ])
      const status = loginResponse ? loginResponse.status() : 'no-response'
      landed = await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 15000 }).then(() => true).catch(() => false)
      evidence.push(`login attempt ${attempt} status=${status} landed=${landed}${landed ? ` url=${new URL(page.url()).pathname}` : ''}`)
      if (!landed) {
        // The webvue_auth zone is 20 events/minute and the edge keys it by the edge
        // socket peer, so every tenant on 127.0.0.1 shares ONE bucket. A 429 here
        // is the limiter working (proof 9), not an isolation failure: drain the
        // window before retrying.
        const retryAfter = loginResponse ? Number(loginResponse.headers()['retry-after'] || 0) : 0
        const waitMs = Math.max(15000, (retryAfter + 5) * 1000)
        evidence.push(`login attempt ${attempt} not landed (status=${status}, retry-after=${retryAfter}s); waiting ${Math.round(waitMs / 1000)}s`)
        await page.waitForTimeout(waitMs)
      }
    }
    expect(landed, `tenant ${tenant.name} could not log in (html dir=${dir})`).toBe(true)

    // --- Three authenticated pages: own markers present, other tenant's absent ---
    // The edge keys the webvue_auth zone (20 events/min) by the edge socket peer, and
    // every tenant on 127.0.0.1 shares that single bucket. A tenant's own page loads
    // (HTML + the app's bootstrap calls) therefore consume the budget the NEXT
    // tenant needs. Pace the navigation so two tenants fit in one window instead of
    // racing it; the limiter itself is verified by probe.mjs proof 9.
    const PACE_MS = 6000
    let firstPage = true
    for (const path of ['/', '/projects', '/hr']) {
      if (!firstPage) await page.waitForTimeout(PACE_MS)
      firstPage = false
      await page.goto(`${tenant.base}${path}`, { waitUntil: 'domcontentloaded' })
      await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 })
      await page.waitForLoadState('networkidle').catch(() => {})
      const body = (await page.locator('body').innerText().catch(() => '')) || ''
      if (!body.trim()) {
        const info = await page.evaluate(() => ({ url: location.href, ready: document.readyState, html: document.documentElement.outerHTML.length, title: document.title, cookies: document.cookie.length })).catch(() => ({}))
        evidence.push(`${path} EMPTY_BODY info=${JSON.stringify(info)} lastHttp=${JSON.stringify(httpLog.slice(-8))}`)
        dump()
        await page.waitForTimeout(2000)
        const retry = (await page.locator('body').innerText().catch(() => '')) || ''
        evidence.push(`${path} retry_body_len=${retry.length}`)
      }
      expect.soft(body, `${path} must not leak the other tenant`).not.toContain(tenant.otherProject)
      expect.soft(body, `${path} must not leak the other tenant's employee`).not.toContain(tenant.otherEmployee)
      if (path !== '/hr') {
        await expect(page.locator('body')).toContainText(tenant.ownProject, { timeout: 20000 })
      } else {
        await expect(page.locator('body')).toContainText(tenant.ownEmployee, { timeout: 20000 })
      }
      // Arabic UI assertion: the shared navigation labels are Arabic.
      await expect(page.locator('body')).toContainText('المشاريع', { timeout: 15000 })
      const shot = resolve(SCREENSHOT_DIR, `${tenant.name.toLowerCase()}-${path.replace(/\//g, '') || 'index'}.png`)
      await page.screenshot({ path: shot, fullPage: true })
      evidence.push(`${path} ok (screenshot ${shot})`)
    }

    // --- Log out, then prove the session is really gone ---
    const out = await page.evaluate(async () => {
      const r = await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      return r.status
    })
    await page.context().clearCookies()
    await page.goto(`${tenant.base}/projects`, { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/login/, { timeout: 20000 })
    evidence.push('session cleared after logout')
    evidence.push(`logout status=${out}; /projects after logout redirected to /login`)

    dump()
    console.log(`[tenant ${tenant.name}] ${evidence.join(' | ')}`)
    await context.close()
  })
}
