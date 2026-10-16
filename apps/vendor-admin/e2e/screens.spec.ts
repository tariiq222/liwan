import { test, type Page } from '@playwright/test'
import { ADMIN_PASSWORD, OWNER_EMAIL, TOTP_CODE } from './mock-settings.mjs'
import { addVirtualAuthenticator, completeEnrollment, mintInvitation, mock, openInvitation, resetMock } from './support'

// Screenshots of every sign-in and enrollment state from the mock stack: Arabic, right to left,
// dark appearance, once at desktop width and once at phone width. The files are looked at by a
// person (they are git-ignored); the assertions of the states themselves live in auth.spec.ts.
const SHOTS = process.env.SHOTS_DIR ?? '../../.superpowers/wave2-D-shots'
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } }

test.beforeEach(async () => { await resetMock() })

async function shoot(page: Page, name: string) {
  // The app has no appearance switch yet; the layer's dark tokens are keyed on this class.
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  for (const [size, viewport] of Object.entries(VIEWPORTS)) {
    await page.setViewportSize(viewport)
    await page.screenshot({ path: `${SHOTS}/${name}-ar-dark-${size}.png`, fullPage: true })
  }
}

async function fallbackAttempt(page: Page, password: string) {
  await page.locator('#email').fill(OWNER_EMAIL)
  await page.locator('#password').fill(password)
  await page.locator('#totp-code').fill(TOTP_CODE)
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
}

test('sign-in states', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'الدخول بمفتاح المرور' }).waitFor()
  await shoot(page, 'login-passkey')

  await page.getByRole('button', { name: 'فقدت جهازك؟' }).click()
  await shoot(page, 'login-fallback')

  await fallbackAttempt(page, 'wrong password 1')
  await page.getByRole('alert').waitFor()
  await shoot(page, 'login-failed')

  for (let attempt = 2; attempt <= 6; attempt += 1) {
    await fallbackAttempt(page, `wrong password ${attempt}`)
    await page.waitForTimeout(150)
  }
  await page.getByRole('alert').filter({ hasText: 'محاولات كثيرة' }).waitFor()
  await shoot(page, 'login-rate-limited')

  await page.getByRole('button', { name: 'العودة إلى مفتاح المرور' }).click()
  await page.getByRole('button', { name: 'استخدم رمز استرداد' }).click()
  await page.locator('#recovery-code').waitFor()
  await shoot(page, 'login-recovery')

  await mock('/__mock/config', 'POST', { unavailable: true })
  await page.getByRole('button', { name: 'العودة إلى مفتاح المرور' }).click()
  await page.getByRole('button', { name: 'الدخول بمفتاح المرور' }).click()
  await page.getByRole('alert').filter({ hasText: 'الخدمة غير متاحة الآن' }).waitFor()
  await shoot(page, 'login-unavailable')
})

test('enrollment states', async ({ page, context }) => {
  await page.goto('/enroll')
  await page.getByRole('heading', { name: 'رابط الدعوة غير صالح' }).waitFor()
  await shoot(page, 'enroll-invalid')

  await addVirtualAuthenticator(context, page)
  const { token } = await mintInvitation()
  await page.goto('/login')
  await openInvitation(page, token)
  await shoot(page, 'enroll-passkey')

  await page.locator('#device-label').fill('Work laptop')
  await page.getByRole('button', { name: 'إضافة مفتاح المرور' }).click()
  await page.locator('[data-slot="totp-setup"] code').waitFor()
  await page.locator('#new-password').fill(ADMIN_PASSWORD)
  await page.locator('#confirm-password').fill(ADMIN_PASSWORD)
  await shoot(page, 'enroll-totp')

  await page.locator('#totp-code').fill(TOTP_CODE)
  await page.getByRole('button', { name: 'إنهاء التفعيل' }).click()
  await page.locator('[data-slot="recovery-codes"]').waitFor()
  await shoot(page, 'enroll-recovery-codes')
})

test('the sign-in page at tablet width in the light appearance', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.goto('/login')
  await page.screenshot({ path: `${SHOTS}/login-passkey-ar-light-tablet.png`, fullPage: true })
})
