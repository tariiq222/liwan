import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { Pool } from 'pg'
// Test-only relative import of the control plane's own RFC 6238 routine (e2e files are outside the VA1 boundary).
import { totpAt, totpStep } from '../../control-plane/src/admin-auth/totp'
import { addVirtualAuthenticator } from './support'

// The live proof: the vendor admin production build against the REAL control plane and a scratch database,
// with real WebAuthn verification (a CDP virtual authenticator). Run it only through
// `node tools/vendor_admin_local_check.mjs`, which starts the stack and exports the LIVE_* values.
const ORIGIN = process.env.LIVE_ADMIN_ORIGIN ?? ''
const BOOTSTRAP_LINK = process.env.LIVE_BOOTSTRAP_LINK ?? ''
const DATABASE_URL = process.env.LIVE_DATABASE_URL ?? ''
const SHOTS = process.env.LIVE_SHOTS_DIR ?? '../../.superpowers/wave4-live-shots'
const OWNER_EMAIL = 'owner@example.test'
const FINANCE_EMAIL = 'finance@example.test'
const OWNER_CAPABILITIES = ['vendor.accounts.manage', 'vendor.audit.read', 'vendor.billing.manage', 'vendor.catalog.manage', 'vendor.operations.run', 'vendor.pricing.manage', 'vendor.read', 'vendor.subscriptions.manage', 'vendor.tenants.manage']
const FAILED = 'تعذّر تسجيل الدخول'
const LOCKED = 'محاولات كثيرة'
// Throwaway passwords for the scratch database, different on every run.
const OWNER_PASSWORD = `Live-${randomBytes(12).toString('base64url')}`
const FINANCE_PASSWORD = `Live-${randomBytes(12).toString('base64url')}`

test.skip(!ORIGIN || !BOOTSTRAP_LINK || !/\/webvue_control_scratch_[a-z0-9_]+$/.test(DATABASE_URL), 'run through tools/vendor_admin_local_check.mjs')
test.describe.configure({ mode: 'serial' })

const pool = new Pool({ connectionString: DATABASE_URL })
const resetAttempts = () => pool.query('DELETE FROM vendor_auth_attempts')
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })

function base32Decode(text: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of text.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | alphabet.indexOf(char)
    bits += 5
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8 }
  }
  return Buffer.from(bytes)
}

/** An authenticator-app code the control plane has not seen: its step is above the last one this account used. */
class Authenticator {
  secret: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  lastStep = 0
  async nextCode(): Promise<string> {
    for (;;) {
      const now = totpStep(Date.now())
      const step = Math.max(now, this.lastStep + 1)
      if (step <= now + 1) { this.lastStep = step; return totpAt(this.secret, step) }
      await sleep(1000)
    }
  }
}

const ownerApp = new Authenticator()
const financeApp = new Authenticator()
let owner: { context: BrowserContext, page: Page }
let invitee: { context: BrowserContext, page: Page }

async function newSession(browser: Browser, withPasskeys = false) {
  const context = await browser.newContext({ baseURL: ORIGIN, locale: 'ar-SA' })
  const page = await context.newPage()
  if (withPasskeys) await addVirtualAuthenticator(context, page)
  return { context, page }
}

/** From the passkey step to the recovery codes, with the setup key read from the page like a person would. */
async function enroll(page: Page, app: Authenticator, password: string, shots?: string): Promise<string[]> {
  await page.locator('#device-label').fill('Live laptop')
  if (shots) await shot(page, `${shots}-1-passkey`)
  await page.getByRole('button', { name: 'إضافة مفتاح المرور' }).click()
  const key = page.locator('[data-slot="totp-setup"] code')
  await expect(key).toBeVisible()
  app.secret = base32Decode(await key.innerText())
  await page.locator('#new-password').fill(password)
  await page.locator('#confirm-password').fill(password)
  await page.locator('#totp-code').fill(await app.nextCode())
  if (shots) await shot(page, `${shots}-2-totp`)
  await page.getByRole('button', { name: 'إنهاء التفعيل' }).click()
  await expect(page.locator('[data-slot="recovery-codes"]')).toBeVisible()
  const codes = (await page.locator('[data-slot="recovery-codes"] li').allTextContents()).map(code => code.trim())
  if (shots) await shot(page, `${shots}-3-recovery-codes`)
  await page.getByLabel('حفظت الرموز في مكان آمن').check()
  await page.getByRole('button', { name: 'متابعة إلى لوحة الإدارة' }).click()
  await expect(page).toHaveURL(/\/overview$/)
  return codes
}

async function fallbackSignIn(page: Page, email: string, password: string, code: string) {
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.locator('#totp-code').fill(code)
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
}

const openFallback = async (page: Page) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'فقدت جهازك؟' }).click()
}

const api = (): Promise<APIRequestContext> => playwrightRequest.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { origin: ORIGIN } })

async function fallbackPost(client: APIRequestContext, email: string, password: string, headers: Record<string, string> = {}) {
  const response = await client.post('/api/auth/fallback', { data: { email, password, totp_code: '123456' }, headers })
  return { status: response.status(), body: await response.text(), type: response.headers()['content-type'] }
}

function cookieFlags(setCookies: string[]) {
  const line = setCookies.find(value => value.startsWith('webvue_admin='))
  expect(line, 'Set-Cookie carries webvue_admin').toBeTruthy()
  const parts = (line as string).split(';').map(part => part.trim().toLowerCase())
  return { httpOnly: parts.includes('httponly'), sameSiteStrict: parts.includes('samesite=strict'), secure: parts.includes('secure'), path: parts.includes('path=/'), hostPrefixed: (line as string).startsWith('__Host-') }
}

test.beforeAll(async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true })
  owner = await newSession(browser, true)
})

test.afterAll(async () => {
  await owner?.context.close()
  await invitee?.context.close()
  await pool.end()
})

test('the owner enrolls from the bootstrap link: passkey, password, authenticator code, recovery codes shown once', async () => {
  const { page } = owner
  await page.goto(BOOTSTRAP_LINK)
  await expect(page.locator('#device-label')).toBeVisible()
  expect(new URL(page.url()).hash).toBe('')
  const codes = await enroll(page, ownerApp, OWNER_PASSWORD, 'enroll')
  expect(codes).toHaveLength(10)
  await expect(page.getByRole('heading', { level: 1, name: 'اليوم' })).toBeVisible()
  await shot(page, 'overview-after-enroll')
  // The real database holds a confirmed authenticator, a passkey and a password hash for the owner.
  const state = await pool.query(`SELECT a.status, a.password_hash IS NOT NULL AS has_password,
      (SELECT count(*) FROM vendor_passkeys p WHERE p.account_id=a.id)::int AS passkeys,
      (SELECT confirmed_at IS NOT NULL FROM vendor_totp t WHERE t.account_id=a.id) AS totp_confirmed
    FROM vendor_accounts a WHERE a.email=$1`, [OWNER_EMAIL])
  expect(state.rows[0]).toMatchObject({ status: 'active', has_password: true, passkeys: 1, totp_confirmed: true })
  // The invitation is single use.
  await page.goto(BOOTSTRAP_LINK)
  await expect(page.getByRole('heading', { name: 'رابط الدعوة غير صالح' })).toBeVisible()
})

test('the context route returns the owner capabilities and the customers page loads', async () => {
  const { page } = owner
  const response = await page.request.get('/api/vendor/v1/context')
  expect(response.status()).toBe(200)
  const body = await response.json() as { enabled: boolean, capabilities: string[] }
  expect(body.enabled).toBe(true)
  expect([...body.capabilities].sort()).toEqual(OWNER_CAPABILITIES)
  await page.goto('/customers')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page).toHaveURL(/\/customers$/)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await shot(page, 'customers-empty')
})

test('sign out, then sign in with the passkey; the cookie is HttpOnly, SameSite=Strict, not Secure on loopback http', async () => {
  const { page, context } = owner
  const status = await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(response => response.status))
  expect(status).toBe(204)
  expect((await context.cookies()).filter(cookie => cookie.name === 'webvue_admin')).toEqual([])
  await page.goto('/overview')
  await expect(page).toHaveURL(/\/login\?next=\/overview$/)
  const verified = page.waitForResponse(response => response.url().endsWith('/api/auth/passkey-verify'))
  await page.getByRole('button', { name: 'الدخول بمفتاح المرور' }).click()
  const flags = cookieFlags((await (await verified).headersArray()).filter(header => header.name.toLowerCase() === 'set-cookie').map(header => header.value))
  expect(flags).toEqual({ httpOnly: true, sameSiteStrict: true, secure: false, path: true, hostPrefixed: false })
  await expect(page).toHaveURL(/\/overview$/)
  expect(await page.evaluate(() => document.cookie)).not.toContain('webvue_admin')
})

test('team: the invitation needs a step-up once the window passed, then the invitee enrolls in a fresh browser', async ({ browser }) => {
  const { page } = owner
  await page.goto('/team')
  await expect(page.getByTestId('team-invite')).toBeVisible()
  // Age the owner session's step-up past the five minute window, directly in the scratch database.
  const aged = await pool.query("UPDATE vendor_sessions SET step_up_at = now() - interval '10 minutes' WHERE revoked_at IS NULL AND account_id=(SELECT id FROM vendor_accounts WHERE email=$1)", [OWNER_EMAIL])
  expect(aged.rowCount).toBeGreaterThan(0)

  const posts: string[] = []
  page.on('request', (request) => { if (request.method() === 'POST') posts.push(new URL(request.url()).pathname) })
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/auth/step-up-options', async (route) => { await held; await route.continue() })
  await page.getByTestId('team-invite').click()
  await page.getByTestId('invite-email').fill(FINANCE_EMAIL)
  await page.getByTestId('invite-name').fill('Live Finance')
  await page.getByLabel('المالية').check()
  await page.getByTestId('invite-reason').fill('live proof finance lead')
  await page.getByTestId('invite-submit').click()
  const panel = page.locator('[data-slot="step-up-panel"]')
  await expect(panel).toBeVisible()
  await shot(page, 'step-up-needed')
  release()

  const linkInput = page.getByTestId('invitation-link-value')
  await expect(linkInput).toBeVisible()
  const link = await linkInput.inputValue()
  expect(link).toMatch(/^http:\/\/localhost:\d+\/enroll#[A-Za-z0-9_-]{43}$/)
  // The first call was refused for the stale step-up, the second went through after the passkey confirmation.
  expect(posts.filter(path => path === '/api/vendor/v1/admin/accounts')).toHaveLength(2)
  expect(posts.filter(path => path === '/api/auth/step-up-verify')).toHaveLength(1)
  const fresh = await pool.query("SELECT count(*)::int AS fresh FROM vendor_sessions s JOIN vendor_accounts a ON a.id=s.account_id WHERE a.email=$1 AND s.revoked_at IS NULL AND s.step_up_at > now() - interval '1 minute'", [OWNER_EMAIL])
  expect(fresh.rows[0].fresh).toBeGreaterThan(0)
  await shot(page, 'team-invitation-link')
  await page.getByTestId('invitation-link-dismiss').click()
  await expect(page.getByRole('row').filter({ hasText: FINANCE_EMAIL })).toContainText('بانتظار قبول الدعوة')

  invitee = await newSession(browser, true)
  await invitee.page.goto(link)
  await expect(invitee.page.locator('#device-label')).toBeVisible()
  expect(await enroll(invitee.page, financeApp, FINANCE_PASSWORD, 'invitee-enroll')).toHaveLength(10)

  await page.reload()
  const row = page.getByRole('row').filter({ hasText: FINANCE_EMAIL })
  await expect(row).toContainText('نشط')
  await shot(page, 'team-after-invite')
})

test('disabling an account ends its session on the next request', async () => {
  const { page } = owner
  expect((await invitee.page.request.get('/api/vendor/v1/context')).status()).toBe(200)
  const row = page.getByRole('row').filter({ hasText: FINANCE_EMAIL })
  await row.getByTestId('team-disable').click()
  await page.getByTestId('action-reason').fill('live proof: disable')
  await page.getByTestId('inline-confirm-action').click()
  await expect(page.getByTestId('team-notice')).toContainText('تم تعطيل حساب')
  await expect(row).toContainText('معطّل')
  expect((await invitee.page.request.get('/api/vendor/v1/context')).status()).toBe(401)
  await shot(page, 'team-after-disable')
})

test('password and authenticator code sign in works once; the same code is refused the second time', async ({ browser }) => {
  const code = await ownerApp.nextCode()
  const first = await newSession(browser)
  await openFallback(first.page)
  const signedIn = first.page.waitForResponse(response => response.url().endsWith('/api/auth/fallback'))
  await fallbackSignIn(first.page, OWNER_EMAIL, OWNER_PASSWORD, code)
  const flags = cookieFlags((await (await signedIn).headersArray()).filter(header => header.name.toLowerCase() === 'set-cookie').map(header => header.value))
  expect(flags).toEqual({ httpOnly: true, sameSiteStrict: true, secure: false, path: true, hostPrefixed: false })
  await expect(first.page).toHaveURL(/\/overview$/)
  await first.context.close()

  const replay = await newSession(browser)
  await openFallback(replay.page)
  await fallbackSignIn(replay.page, OWNER_EMAIL, OWNER_PASSWORD, code)
  await expect(replay.page.getByRole('alert')).toContainText(FAILED)
  await expect(replay.page).toHaveURL(/\/login$/)
  await replay.context.close()
})

test('an unknown email and a wrong password are indistinguishable', async () => {
  await resetAttempts()
  const client = await api()
  const unknown = await fallbackPost(client, 'nobody@example.test', OWNER_PASSWORD)
  const wrong = await fallbackPost(client, OWNER_EMAIL, 'a wrong password entirely')
  expect(unknown.status).toBe(401)
  expect(unknown).toEqual(wrong)
  expect(JSON.parse(unknown.body)).toEqual({ code: 'auth_failed' })
  await client.dispose()
})

test('a browser supplied client address is ignored: the attempt scope comes from the socket address', async () => {
  await resetAttempts()
  const client = await api()
  await fallbackPost(client, OWNER_EMAIL, 'wrong password one', { 'x-forwarded-for': '203.0.113.9', 'x-webvue-client-ip': '198.51.100.7' })
  await fallbackPost(client, OWNER_EMAIL, 'wrong password two', { 'x-forwarded-for': '203.0.113.10', 'x-webvue-client-ip': '198.51.100.8' })
  const scopes = (await pool.query('SELECT scope, failures FROM vendor_auth_attempts ORDER BY scope')).rows as { scope: string, failures: number }[]
  const ipScopes = scopes.filter(row => row.scope.startsWith('ip:'))
  // One ip scope for both requests, and it is a loopback address (the BFF's socket), never the claimed ones.
  expect(ipScopes).toHaveLength(1)
  // IPv4 loopback counts as itself; IPv6 loopback counts as its /64 group.
  expect(['ip:127.0.0.1', 'ip:0:0:0:0::/64']).toContain(ipScopes[0]!.scope)
  expect(ipScopes[0]!.failures).toBe(2)
  expect(JSON.stringify(scopes)).not.toMatch(/203\.0\.113|198\.51\.100/)
  await client.dispose()
})

test('six wrong sign-ins show the rate-limit message and the right password stays locked out', async ({ browser }) => {
  await resetAttempts()
  const { context, page } = await newSession(browser)
  await openFallback(page)
  const alert = page.getByRole('alert')
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await fallbackSignIn(page, OWNER_EMAIL, `wrong password ${attempt}`, '000000')
    await expect(alert).toContainText(FAILED)
  }
  await fallbackSignIn(page, OWNER_EMAIL, 'wrong password 6', '000000')
  await expect(alert).toContainText(LOCKED)
  await expect(alert).not.toContainText(FAILED)
  await shot(page, 'rate-limited')
  await fallbackSignIn(page, OWNER_EMAIL, OWNER_PASSWORD, '000000')
  await expect(alert).toContainText(LOCKED)
  await context.close()
})

test('release gate: a request from an already locked address does not raise the account counter', async () => {
  await resetAttempts()
  const client = await api()
  const statuses: number[] = []
  for (let attempt = 1; attempt <= 21; attempt += 1) statuses.push((await fallbackPost(client, `victim${attempt}@example.test`, 'a wrong password entirely')).status)
  expect(statuses.slice(0, 20)).toEqual(Array(20).fill(401))
  expect(statuses[20]).toBe(429)
  // The address is locked now; further attempts name the owner's account and must not touch its counter.
  for (const password of ['still wrong one', OWNER_PASSWORD, 'still wrong two']) expect((await fallbackPost(client, OWNER_EMAIL, password)).status).toBe(429)
  const rows = (await pool.query('SELECT scope, failures, locked_until FROM vendor_auth_attempts')).rows as { scope: string, failures: number, locked_until: Date | null }[]
  expect(rows.find(row => row.scope === `account:${OWNER_EMAIL}`)).toBeUndefined()
  const accountRows = rows.filter(row => row.scope.startsWith('account:'))
  expect(accountRows).toHaveLength(20)
  expect(Math.max(...accountRows.map(row => row.failures))).toBeLessThanOrEqual(1)
  const ipRow = rows.find(row => row.scope.startsWith('ip:'))
  expect(ipRow?.locked_until).not.toBeNull()
  await resetAttempts()
  await client.dispose()
})
