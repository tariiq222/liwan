import { expect, type Page, type Route } from '@playwright/test'
import { AdminUserDetailSchema, PermissionCatalogSchema, RoleDetailSchema, RoleListSchema, SeatUsageSchema } from '@liwan/contracts'
import { collectBrowserErrors, heading, MOCK_STACK_ONLY, trackRefusedRequests } from './support/mock-pages'
import { fitsWidth, login, open } from './support/tasmim6'
import { setSsrFixture, test } from './ssr-fixture'

test.skip(process.env.E2E_PROJECT_POPUPS !== '1', MOCK_STACK_ONLY)

// Invitation journeys parse their own fixtures with the contracts. Administrator reads
// reach both SSR and browser requests through a session-scoped mock fixture; browser
// routes retain the per-test mutation recording and public-page error scenarios.
const PASSWORD = 'twelve-chars!'
const COMPANY = { kind: 'company', id: 1, name: 'شركة المثال' } as const
const ROLE = { id: 3, key: 'employee', name: { ar: 'موظف', en: 'Employee' }, type: 'built_in', protected: false } as const
const ok = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
const refusal = (status: number, code: string, message = 'refused', field?: string) => ok({ code, message, ...(field ? { field } : {}) }, status)

let errors: string[]
let tolerate: (errors: string[]) => string[]

test.beforeEach(({ page }) => {
  errors = collectBrowserErrors(page)
  tolerate = trackRefusedRequests(page, '/api/v1/')
})

test.afterEach(async ({ page }) => {
  // Finish background /me route.fetch callbacks before Playwright disposes their responses.
  await page.unrouteAll({ behavior: 'wait' })
  expect(tolerate(errors), 'no page error and no console error').toEqual([])
})

function pendingUser(overrides: Record<string, unknown> = {}) {
  return AdminUserDetailSchema.parse({
    id: 21, name: 'سارة محمد', login: 'sara@example.com', mobile: null,
    invitation: { state: 'pending', delivery: 'sent', sent_at: '2026-11-06T10:00:00Z', expires_at: '2026-11-09T10:00:00Z' },
    employee: null, active: true, protected: false, version: 'u21-v1',
    assignments: [{ id: 211, role: ROLE, scope: COMPANY }],
    capabilities: [], allowed_actions: ['read', 'send_reset_link', 'disable', 'resend_invitation', 'edit_invitation', 'cancel_invitation'],
    ...overrides,
  })
}

/** The administrator routes this spec needs; `seats` is the answer of `/users/seats` and `user` the account the detail pages read. */
async function mockAdmin(page: Page, options: { seats?: unknown; user?: ReturnType<typeof pendingUser> } = {}) {
  const calls: { method: string; path: string; body: unknown }[] = []
  const user = options.user ?? pendingUser()
  const reads: Record<string, unknown> = {
    '/users/seats': SeatUsageSchema.parse(options.seats ?? { used: 6, limit: 10 }),
    '/roles': RoleListSchema.parse({ items: [{ ...ROLE, description: '', active: true, assignable: true, user_count: 2, version: 'r3' }], total: 1 }),
    '/roles/3': RoleDetailSchema.parse({ ...ROLE, description: '', active: true, assignable: true, user_count: 2, version: 'r3', permissions: [], allowed_actions: ['read'] }),
    '/permissions': PermissionCatalogSchema.parse({ items: [], total: 0, version: 'p1' }),
    [`/users/${user.id}`]: user,
  }
  await setSsrFixture(page, { reads: Object.fromEntries(Object.entries(reads).map(([path, body]) => [`/api/v1/admin${path}`, body])) })
  await page.route('**/api/v1/admin/**', async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace('/api/v1/admin', '')
    const method = request.method()
    if (method !== 'GET') calls.push({ method, path, body: request.postDataJSON() })
    if (method === 'GET') {
      if (Object.hasOwn(reads, path)) return route.fulfill(ok(reads[path]))
      return route.fulfill(refusal(404, 'not_found'))
    }
    if (method === 'POST' && path === '/users') return route.fulfill(ok(pendingUser({ id: 30, name: 'خالد', login: 'khalid@example.com' }), 201))
    if (path === `/users/${user.id}/invitation/cancel`) return route.fulfill(ok(pendingUser({ active: false, invitation: null, allowed_actions: ['read', 'reactivate'] })))
    return route.fulfill(ok(user))
  })
  return calls
}

const fieldFor = (page: Page, id: string) => page.locator(`#${id}`)

test.describe('the anonymous account-link pages', () => {
  test('join: the invitee sets a mobile number and password, and is sent to sign in', async ({ page }) => {
    await page.route('**/api/v1/public/account/token', route => route.fulfill(ok({ usable: true })))
    const accepted: unknown[] = []
    await page.route('**/api/v1/public/account/invitation/accept', (route) => { accepted.push(route.request().postDataJSON()); return route.fulfill(ok({ login: 'sara@example.com' })) })
    await page.goto('/join?token=tok-abc')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(heading(page, 'قبول الدعوة')).toBeVisible()
    const submit = page.getByRole('button', { name: 'تفعيل الحساب', exact: true })
    await expect(fieldFor(page, 'mobile')).toBeVisible()
    await expect(submit).toBeDisabled()
    await fieldFor(page, 'mobile').fill('0500000001')
    await fieldFor(page, 'password').fill(PASSWORD)
    await fieldFor(page, 'confirm').fill(`${PASSWORD}x`)
    await expect(submit).toBeDisabled()
    await fieldFor(page, 'confirm').fill(PASSWORD)
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(page.getByRole('status').filter({ hasText: 'تم تفعيل حسابك' })).toBeVisible()
    expect(accepted).toEqual([{ token: 'tok-abc', mobile: '+966500000001', password: PASSWORD }])
    await expect(page.getByRole('link', { name: 'الانتقال إلى تسجيل الدخول' })).toHaveAttribute('href', '/login?login=sara@example.com')
  })

  test('join: a used, revoked or missing link says so and shows no form', async ({ page }) => {
    await page.route('**/api/v1/public/account/token', route => route.fulfill(ok({ usable: false })))
    await page.goto('/join?token=tok-old')
    await expect(page.getByRole('alert').filter({ hasText: 'انتهت صلاحية الدعوة أو استُخدمت' })).toBeVisible()
    await expect(fieldFor(page, 'password')).toHaveCount(0)
    await page.goto('/join')
    await expect(page.getByRole('alert').filter({ hasText: 'انتهت صلاحية الدعوة أو استُخدمت' })).toBeVisible()
  })

  test('join: an unavailable service keeps what was typed and the same button retries; a taken number names itself', async ({ page }) => {
    await page.route('**/api/v1/public/account/token', route => route.fulfill(ok({ usable: true })))
    const answers = [refusal(429, 'rate_limited'), refusal(409, 'mobile_taken', 'taken', 'mobile'), ok({ login: 'sara@example.com' })]
    await page.route('**/api/v1/public/account/invitation/accept', route => route.fulfill(answers.shift()!))
    await page.goto('/join?token=tok-abc')
    await fieldFor(page, 'mobile').fill('+966500000001')
    await fieldFor(page, 'password').fill(PASSWORD)
    await fieldFor(page, 'confirm').fill(PASSWORD)
    await page.getByRole('button', { name: 'تفعيل الحساب', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'الخدمة غير متاحة حاليًا' })).toBeVisible()
    await expect(fieldFor(page, 'password')).toHaveValue(PASSWORD)
    await expect(fieldFor(page, 'mobile')).toHaveValue('+966500000001')
    await page.getByRole('button', { name: 'إعادة المحاولة', exact: true }).click()
    await expect(page.getByText('رقم الجوال هذا مستخدم في حساب آخر.')).toBeVisible()
    await expect(fieldFor(page, 'mobile')).toHaveValue('+966500000001')
    await page.getByRole('button', { name: 'تفعيل الحساب', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'تم تفعيل حسابك' })).toBeVisible()
  })

  test('forgot-password: the sign-in page links to it and every email gets the same confirmation', async ({ page }) => {
    const asked: unknown[] = []
    await page.route('**/api/v1/public/account/password/forgot', (route) => { asked.push(route.request().postDataJSON()); return route.fulfill(ok({}, 202)) })
    await page.goto('/login')
    await page.getByRole('link', { name: 'نسيت كلمة المرور؟' }).click()
    await expect(page).toHaveURL(/\/forgot-password$/)
    await expect(heading(page, 'نسيت كلمة المرور؟')).toBeVisible()
    const send = page.getByRole('button', { name: 'إرسال الرابط', exact: true })
    await expect(send).toBeDisabled()
    await fieldFor(page, 'email').fill('sara@example.com')
    await send.click()
    const confirmation = page.getByRole('status').filter({ hasText: 'تحقق من بريدك' })
    await expect(confirmation).toBeVisible()
    const first = await confirmation.textContent()
    await page.goto('/forgot-password')
    await fieldFor(page, 'email').fill('nobody@example.com')
    await page.getByRole('button', { name: 'إرسال الرابط', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'تحقق من بريدك' })).toHaveText(first!)
    expect(asked).toEqual([{ email: 'sara@example.com' }, { email: 'nobody@example.com' }])
    expect(page.url()).not.toContain('nobody')
  })

  test('reset-password: a new password is saved with the token alone, and a dead link is refused', async ({ page }) => {
    const usable = { value: true }
    await page.route('**/api/v1/public/account/token', route => route.fulfill(ok({ usable: usable.value })))
    const resets: unknown[] = []
    await page.route('**/api/v1/public/account/password/reset', (route) => { resets.push(route.request().postDataJSON()); return route.fulfill(ok({ login: 'sara@example.com' })) })
    await page.goto('/reset-password?token=tok-reset')
    await expect(heading(page, 'كلمة مرور جديدة')).toBeVisible()
    await expect(fieldFor(page, 'mobile')).toHaveCount(0)
    await fieldFor(page, 'password').fill('short')
    await fieldFor(page, 'confirm').fill('short')
    await expect(page.getByRole('button', { name: 'حفظ كلمة المرور', exact: true })).toBeDisabled()
    await fieldFor(page, 'password').fill(PASSWORD)
    await fieldFor(page, 'confirm').fill(PASSWORD)
    await page.getByRole('button', { name: 'حفظ كلمة المرور', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'تم تغيير كلمة المرور' })).toBeVisible()
    expect(resets).toEqual([{ token: 'tok-reset', password: PASSWORD }])
    usable.value = false
    await page.goto('/reset-password?token=tok-reset')
    await expect(page.getByRole('alert').filter({ hasText: 'الرابط غير صالح أو انتهت صلاحيته' })).toBeVisible()
  })

  test('the pages render in Arabic RTL, light and dark, and fit a phone', async ({ page }, testInfo) => {
    await page.route('**/api/v1/public/account/token', route => route.fulfill(ok({ usable: true })))
    await page.setViewportSize({ width: 390, height: 844 })
    for (const path of ['/join?token=tok-abc', '/forgot-password', '/reset-password?token=tok-reset']) {
      for (const scheme of ['light', 'dark'] as const) {
        await page.goto(path)
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
        await expect(page.locator('input').first()).toBeVisible()
        await page.evaluate(mode => document.documentElement.classList.toggle('dark', mode === 'dark'), scheme)
        expect(await fitsWidth(page)).toBe(true)
        await page.screenshot({ path: testInfo.outputPath(`${path.split('?')[0]!.slice(1)}-${scheme}.png`), fullPage: true })
      }
    }
  })
})

test.describe('the administrator screens', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test('adding a user shows the seat, takes no password and confirms the address the invitation went to', async ({ page }, testInfo) => {
    const calls = await mockAdmin(page)
    await page.goto('/settings/team/users/new')
    await expect(page.getByTestId('seat-line')).toHaveText('هذا المستخدم رقم 7 من 10 في اشتراكك.')
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('add-user.png'), fullPage: true })
    const send = page.getByRole('button', { name: 'إرسال الدعوة', exact: true })
    await expect(send).toBeDisabled()
    await fieldFor(page, 'name').fill('خالد')
    await fieldFor(page, 'login').fill('khalid@example.com')
    await page.getByRole('checkbox').first().check()
    await expect(send).toBeEnabled()
    await send.click()
    await expect(page.getByRole('status').filter({ hasText: 'أرسلنا دعوة إلى khalid@example.com' })).toBeVisible()
    expect(calls).toEqual([{ method: 'POST', path: '/users', body: { name: 'خالد', login: 'khalid@example.com', assignments: [{ role_id: expect.any(Number), scope: { kind: 'company', id: expect.any(Number) } }] } }])
  })

  test('at the seat limit the form says so and cannot send; without a limit it shows no seat line', async ({ page }) => {
    await mockAdmin(page, { seats: { used: 10, limit: 10 } })
    await page.goto('/settings/team/users/new')
    await expect(page.getByRole('alert').filter({ hasText: 'وصل اشتراكك إلى الحد الأقصى' })).toBeVisible()
    await fieldFor(page, 'name').fill('خالد')
    await fieldFor(page, 'login').fill('khalid@example.com')
    await page.getByRole('checkbox').first().check()
    await expect(page.getByRole('button', { name: 'إرسال الدعوة', exact: true })).toBeDisabled()
    await page.unroute('**/api/v1/admin/**')
    await mockAdmin(page, { seats: { used: 3, limit: null } })
    await page.goto('/settings/team/users/new')
    await expect(page.getByRole('button', { name: 'إرسال الدعوة', exact: true })).toBeVisible()
    await expect(page.getByTestId('seat-line')).toHaveCount(0)
  })

  test('a pending user shows its state and can be resent, corrected and cancelled inline', async ({ page }, testInfo) => {
    const calls = await mockAdmin(page)
    await page.goto('/settings/team/users/21')
    await expect(page.getByText('بانتظار القبول').first()).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('pending-user.png'), fullPage: true })
    await page.getByRole('button', { name: 'إعادة إرسال الدعوة', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'أعدنا إرسال الدعوة إلى sara@example.com' })).toBeVisible()
    await page.getByRole('button', { name: 'تعديل البريد الإلكتروني', exact: true }).click()
    await fieldFor(page, 'invitation-login').fill('sara.new@example.com')
    await page.getByRole('button', { name: 'حفظ وإرسال دعوة جديدة', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'sara.new@example.com' })).toBeVisible()
    await page.getByRole('button', { name: 'إلغاء الدعوة', exact: true }).click()
    await expect(page.getByTestId('inline-confirm')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByTestId('inline-confirm-action').click()
    await expect(page.getByRole('status').filter({ hasText: 'أُلغيت الدعوة' })).toBeVisible()
    expect(calls).toEqual([
      { method: 'POST', path: '/users/21/invitation/resend', body: { expected_version: 'u21-v1' } },
      { method: 'PATCH', path: '/users/21/invitation', body: { login: 'sara.new@example.com', expected_version: 'u21-v1' } },
      { method: 'POST', path: '/users/21/invitation/cancel', body: { expected_version: 'u21-v1' } },
    ])
  })

  test('an expired invitation and a mail that never arrived are named on the user page', async ({ page }) => {
    await mockAdmin(page, { user: pendingUser({ invitation: { state: 'expired', delivery: 'sent', sent_at: '2026-11-01T10:00:00Z', expires_at: '2026-11-04T10:00:00Z' } }) })
    await page.goto('/settings/team/users/21')
    await expect(page.getByText('انتهت الدعوة').first()).toBeVisible()
    await page.unroute('**/api/v1/admin/**')
    await mockAdmin(page, { user: pendingUser({ invitation: { state: 'pending', delivery: 'failed', sent_at: null, expires_at: '2026-11-09T10:00:00Z' } }) })
    await page.goto('/settings/team/users/21')
    await expect(page.getByText('لم تصل الدعوة').first()).toBeVisible()
  })

  test('security: a reset link replaces the password field and is confirmed inline', async ({ page }) => {
    const calls = await mockAdmin(page)
    await page.goto('/settings/team/users/21/security')
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
    await page.getByRole('button', { name: 'إرسال رابط إعادة تعيين', exact: true }).click()
    await expect(page.getByTestId('inline-confirm')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByTestId('inline-confirm-action').click()
    await expect(page.getByRole('status').filter({ hasText: 'أرسلنا رابط إعادة التعيين' })).toBeVisible()
    expect(calls).toEqual([{ method: 'POST', path: '/users/21/reset-link', body: { expected_version: 'u21-v1' } }])
  })
})

test.describe('the mobile step', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test('a signed-in user without a number is held on the step until it is saved, then returns where they were going', async ({ page }) => {
    let required = true
    let base: Record<string, unknown> = {}
    await page.route('**/api/v1/me', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      base = await (await route.fetch()).json()
      return route.fulfill(ok({ ...base, mobile: required ? null : '+966500000001', mobile_required: required }))
    })
    const saved: unknown[] = []
    await page.route('**/api/v1/me/mobile', async (route) => {
      saved.push(route.request().postDataJSON())
      if (saved.length === 1) return route.fulfill(refusal(409, 'mobile_taken', 'taken', 'mobile'))
      required = false
      return route.fulfill(ok({ ...base, mobile: '+966500000001', mobile_required: false }))
    })
    await open(page, '/account')
    await page.evaluate(() => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } }).useNuxtApp().$router.push('/tasks'))
    await expect(page).toHaveURL(/\/account\/mobile\?next=\/tasks$/)
    await expect(heading(page, 'أضف رقم جوالك')).toBeVisible()
    await page.evaluate(() => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } }).useNuxtApp().$router.push('/projects'))
    await expect(page).toHaveURL(/\/account\/mobile\?next=\/projects$/)
    const submit = page.getByRole('button', { name: 'حفظ ومتابعة', exact: true })
    await expect(page.getByRole('button', { name: 'تسجيل الخروج', exact: true })).toBeVisible()
    await expect(submit).toBeDisabled()
    await fieldFor(page, 'mobile').fill('0500000001')
    await submit.click()
    await expect(page.getByText('رقم الجوال هذا مستخدم في حساب آخر.')).toBeVisible()
    await submit.click()
    await expect(page).toHaveURL(/\/projects/)
    expect(saved).toEqual([{ mobile: '+966500000001' }, { mobile: '+966500000001' }])
  })

  test('the step renders in Arabic RTL, light and dark, and fits a phone', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    for (const scheme of ['light', 'dark'] as const) {
      await page.goto('/account/mobile')
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
      await expect(fieldFor(page, 'mobile')).toBeVisible()
      await page.evaluate(mode => document.documentElement.classList.toggle('dark', mode === 'dark'), scheme)
      expect(await fitsWidth(page)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`account-mobile-${scheme}.png`), fullPage: true })
    }
  })
})
