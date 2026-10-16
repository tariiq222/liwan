import { expect, test, type Page } from '@playwright/test'
import { ADMIN_PASSWORD, OWNER_EMAIL, TOTP_CODE } from './mock-settings.mjs'
import { addVirtualAuthenticator, completeEnrollment, leaveRecoveryCodes, mintInvitation, mock, mockStats, openInvitation, resetMock, signOutRequest } from './support'

const FAILED = 'تعذّر تسجيل الدخول'
const LOCKED = 'محاولات كثيرة'
const UNAVAILABLE = 'الخدمة غير متاحة الآن'
const alert = (page: Page) => page.getByRole('alert')

test.beforeEach(async () => { await resetMock() })

async function openFallback(page: Page, path = '/login') {
  await page.goto(path)
  await page.getByRole('button', { name: 'فقدت جهازك؟' }).click()
}

async function submitFallback(page: Page, email: string, password: string, code = TOTP_CODE) {
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.locator('#totp-code').fill(code)
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
}

test.describe('protection of pages', () => {
  test('a protected page redirects to /login with a safe next', async ({ page }) => {
    await page.goto('/customers?q=a')
    await expect(page).toHaveURL(/\/login\?next=/)
    expect(new URL(page.url()).searchParams.get('next')).toBe('/customers?q=a')
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('an unsafe next is ignored after sign-in', async ({ page }) => {
    await openFallback(page, '/login?next=//evil.example/x')
    await submitFallback(page, OWNER_EMAIL, ADMIN_PASSWORD)
    await expect(page).toHaveURL(/localhost:\d+\/$/)
  })

  test('sign-in returns to the page that was asked for', async ({ page }) => {
    await page.goto('/customers?q=a')
    await page.getByRole('button', { name: 'فقدت جهازك؟' }).click()
    await submitFallback(page, OWNER_EMAIL, ADMIN_PASSWORD)
    await expect(page).toHaveURL(/\/customers\?q=a$/)
  })
})

test.describe('enrollment and passkey sign-in', () => {
  test('enrolls from a hash link, shows the recovery codes once, then signs in again with the passkey', async ({ page, context }) => {
    await addVirtualAuthenticator(context, page)
    const { token } = await mintInvitation()
    const urls: string[] = []
    page.on('request', request => urls.push(request.url()))

    await openInvitation(page, token)
    // The token left the address bar before anything was asked of the server, and no URL carried it.
    expect(new URL(page.url()).hash).toBe('')
    expect(page.url()).not.toContain(token)
    expect(urls.filter(url => url.includes(token))).toEqual([])

    const codes = await completeEnrollment(page)
    expect(codes).toHaveLength(10)
    // Codes live in the page only: not in the address, nor in any browser storage.
    expect(page.url()).not.toContain(codes[0]!)
    const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]))
    for (const code of codes) expect(stored).not.toContain(code)
    await expect(page.getByRole('button', { name: 'متابعة إلى لوحة الإدارة' })).toBeDisabled()
    await leaveRecoveryCodes(page)
    await expect(page.getByRole('heading', { name: 'نسق' })).toBeVisible()

    // The invitation is single use.
    await page.goto(`/enroll#${token}`)
    await expect(page.getByRole('heading', { name: 'رابط الدعوة غير صالح' })).toBeVisible()

    // Sign out (the cookie is cleared), the protected home redirects, then the passkey signs back in.
    expect(await signOutRequest(page)).toBe(204)
    expect((await context.cookies()).filter(cookie => cookie.name === 'nasq_admin')).toEqual([])
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'الدخول بمفتاح المرور' }).click()
    await expect(page).toHaveURL(/localhost:\d+\/$/)
    await expect(page.getByRole('heading', { name: 'نسق' })).toBeVisible()
    const cookie = (await context.cookies()).find(item => item.name === 'nasq_admin')
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' })
    expect(await page.evaluate(() => document.cookie)).not.toContain('nasq_admin')
  })

  test('a link without a valid token shows the invalid state and sends nothing', async ({ page }) => {
    await page.goto('/enroll')
    await expect(page.getByRole('heading', { name: 'رابط الدعوة غير صالح' })).toBeVisible()
    await page.goto('/login')
    await page.goto(`/enroll#${'x'.repeat(43)}`)
    await expect(page.getByRole('heading', { name: 'رابط الدعوة غير صالح' })).toBeVisible()
    expect(new URL(page.url()).hash).toBe('')
  })

  test('a cancelled passkey prompt keeps the page and says so', async ({ page, context }) => {
    // No authenticator is attached: the browser has no passkey to offer and refuses the request.
    const { token } = await mintInvitation()
    await openInvitation(page, token)
    await page.getByRole('button', { name: 'إضافة مفتاح المرور' }).click()
    await expect(alert(page)).toBeVisible()
    await expect(page.locator('#device-label')).toBeVisible()
    expect(await context.cookies()).toEqual([])
  })
})

test.describe('fallback sign-in', () => {
  test('signs in with password and authenticator code', async ({ page, context }) => {
    await openFallback(page)
    await submitFallback(page, OWNER_EMAIL, ADMIN_PASSWORD)
    await expect(page).toHaveURL(/localhost:\d+\/$/)
    expect((await context.cookies()).some(cookie => cookie.name === 'nasq_admin')).toBe(true)
    // Every request the BFF made was signed and accepted; none was rejected.
    const stats = await mockStats()
    expect(stats.rejected).toBe(0)
    expect(stats.anonymous).toBeGreaterThan(0)
    expect(stats.numeric).toBeGreaterThan(0)
  })

  test('a wrong password and an unknown email show the same message', async ({ page }) => {
    await openFallback(page)
    await submitFallback(page, OWNER_EMAIL, 'wrong wrong wrong')
    await expect(alert(page)).toContainText(FAILED)
    const wrongPassword = await alert(page).innerText()
    await submitFallback(page, 'nobody@example.test', ADMIN_PASSWORD)
    await expect(alert(page)).toContainText(FAILED)
    expect(await alert(page).innerText()).toBe(wrongPassword)
    await expect(page).toHaveURL(/\/login$/)
  })

  test('the sixth failure shows the rate-limit message', async ({ page }) => {
    await openFallback(page)
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await submitFallback(page, OWNER_EMAIL, `wrong password ${attempt}`)
      await expect(alert(page)).toContainText(FAILED)
    }
    await submitFallback(page, OWNER_EMAIL, 'wrong password 6')
    await expect(alert(page)).toContainText(LOCKED)
    await expect(alert(page)).not.toContainText(FAILED)
  })

  test('signs in once with a recovery code, then the same code is refused', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: 'استخدم رمز استرداد' }).click()
    await page.locator('#email').fill(OWNER_EMAIL)
    await page.locator('#password').fill(ADMIN_PASSWORD)
    await page.locator('#recovery-code').fill('abcd-efgh-jkmn')
    await page.getByRole('button', { name: 'دخول', exact: true }).click()
    await expect(page).toHaveURL(/localhost:\d+\/$/)
    await signOutRequest(page)
    await page.goto('/login')
    await page.getByRole('button', { name: 'استخدم رمز استرداد' }).click()
    await page.locator('#email').fill(OWNER_EMAIL)
    await page.locator('#password').fill(ADMIN_PASSWORD)
    await page.locator('#recovery-code').fill('abcd-efgh-jkmn')
    await page.getByRole('button', { name: 'دخول', exact: true }).click()
    await expect(alert(page)).toContainText(FAILED)
  })

  test('shows the unavailable message when the control plane answers 503', async ({ page }) => {
    await mock('/__mock/config', 'POST', { unavailable: true })
    await openFallback(page)
    await submitFallback(page, OWNER_EMAIL, ADMIN_PASSWORD)
    await expect(alert(page)).toContainText(UNAVAILABLE)
    await page.getByRole('button', { name: 'العودة إلى مفتاح المرور' }).click()
    await page.getByRole('button', { name: 'الدخول بمفتاح المرور' }).click()
    await expect(alert(page)).toContainText(UNAVAILABLE)
  })
})
