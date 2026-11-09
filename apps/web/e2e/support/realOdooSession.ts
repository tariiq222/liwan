import { expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

// The one origin the real-Odoo stack serves (deploy/ci/e2e-odoo.sh); every spec asserts it before browsing.
export const ACCEPTANCE_ORIGIN = 'http://localhost:44300'

// The accounts apps/web/e2e/fixtures/real-odoo-acceptance.py exposes: the `e2e_*` users tools/e2e_seed.py creates
// plus the fixture's own capability combinations. A spec names the account by key, never by login literal.
export type SeededAccount =
  | 'admin' | 'reader' | 'staff1' | 'staff2' | 'hr_manager' | 'no_roles'
  | 'it_admin' | 'access_member' | 'access_reader' | 'access_actor'
  | 'finance_reader' | 'leave_config' | 'leave_staff' | 'pmo_manager' | 'payroll_officer'

export interface SeededUser { login: string, password: string }

export interface Fixtures {
  company: number
  admin: number
  reader: number
  department: number
  employee: number
  reader_employee: number
  admin_employee: number
  grant_employee: number
  grant_email: string
  /** The employee the leave journeys request for, with a seeded 21-day annual balance. */
  leave_employee: number
  /** The dedicated leave type the leave journeys use: allocation required, one manager decision. */
  leave_type: number
  /** One remembered-device token per account: a scratch stack has no SMS provider and stores only the code's
   *  hash, so a spec finishes the mandatory second step through the feature's own device path. */
  device: Record<SeededAccount, string>
  accounts: Record<SeededAccount, SeededUser>
  access_employees: Record<'it_admin' | 'hr_manager' | 'access_member', number>
}

let cached: Fixtures | null = null

/** The fixture the coordinator exported for this run (E2E_REAL_FIXTURE). */
export function fixtures(): Fixtures {
  if (cached) return cached
  const path = process.env.E2E_REAL_FIXTURE
  if (!path) throw new Error('E2E_REAL_FIXTURE must name the coordinator exported scratch fixture JSON')
  cached = JSON.parse(readFileSync(path, 'utf8')) as Fixtures
  return cached
}

/** The login and password of one seeded account. */
export function account(name: SeededAccount = 'admin'): SeededUser {
  const user = fixtures().accounts[name]
  if (!user) throw new Error(`the fixture exposes no account named ${name}`)
  return user
}

/**
 * Signs PAGE in as a seeded account. Every sign-in is two-step: the password step leaves a pre-session, then a code
 * or a remembered device finishes it; the fixture seeds one device per account, so this drives the feature's own
 * second path instead of a code the test cannot read.
 *
 * The cookie jar is cleared first, so one browser context never carries another test's or account's session and
 * device into this sign-in. A page already showing another identity is navigated to a blank document for the same
 * reason: its still-mounted queries would otherwise keep firing with the outgoing session, and a reply that ends it
 * can drop the `session_id` this sign-in just received.
 */
export async function signIn(page: Page, name: SeededAccount = 'admin'): Promise<void> {
  const token = fixtures().device[name]
  expect(token, `the fixture must seed a remembered device for ${name}`).toBeTruthy()
  if (page.url() !== 'about:blank') await page.goto('about:blank')
  await page.context().clearCookies()
  await page.context().addCookies([{ name: 'liwan_device', value: token, url: ACCEPTANCE_ORIGIN, httpOnly: true, sameSite: 'Lax' }])
  const step = await (await page.request.post('/api/auth/login', { data: account(name) })).json()
  expect(step, `the password step of ${name} must leave a pending second step`).toEqual({ ok: false, mfa: 'code' })
  const finished = await page.request.post('/api/auth/device', { data: {} })
  expect(finished.status(), await finished.text()).toBe(200)
  // The session is usable before the caller's next navigation; prove it here instead of failing later in the journey.
  const me = await page.request.get('/api/v1/me')
  expect(me.status(), `the session of ${name} must answer /api/v1/me`).toBe(200)
}

/** Opens PATH and waits for the shell to hydrate (the global search trigger is the shell's own signal). */
export async function openShell(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
}

/** Signs a freshly created browser context in as NAME, for the two-user journeys. */
export async function signedInPage(browser: import('@playwright/test').Browser, name: SeededAccount) {
  const context = await browser.newContext({ baseURL: ACCEPTANCE_ORIGIN, locale: 'ar-SA' })
  const page = await context.newPage()
  await signIn(page, name)
  return { context, page }
}
