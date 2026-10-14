import { expect, test } from '@playwright/test'

// Plan 6d: /login on SharedStandalonePage (isolated mock stack; no shell, no session).
test.describe('Plan 6d: the sign-in page', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('is a standalone card: one main, one h1, the brand and the form', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('main')).toHaveCount(1)
    await expect(page.locator('[data-template="standalone-page"][data-variant="card"]')).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByLabel('اسم المستخدم')).toBeVisible()
    await expect(page.getByLabel('كلمة المرور', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeVisible()
    expect(await page.locator('.nasq-login-page, .nasq-login-card').count()).toBe(0)
  })

  test('the submit stays disabled until hydration and keeps a prefilled login', async ({ page }) => {
    await page.route('**/_nuxt/**', async (route) => { await new Promise(resolve => setTimeout(resolve, 600)); await route.continue() })
    await page.goto('/login', { waitUntil: 'commit' })
    await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeDisabled()
    await page.getByLabel('اسم المستخدم').fill('admin')
    await page.getByLabel('كلمة المرور', { exact: true }).fill('prefilled-secret')
    await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeEnabled({ timeout: 20_000 })
    await expect(page.getByLabel('اسم المستخدم')).toHaveValue('admin')
    await expect(page.getByLabel('كلمة المرور', { exact: true })).toHaveValue('prefilled-secret')
  })

  test('a wrong password shows the alert and keeps the form', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeEnabled()
    await page.getByLabel('اسم المستخدم').fill('admin')
    await page.getByLabel('كلمة المرور', { exact: true }).fill('definitely-wrong')
    await page.route('**/api/auth/login', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{"data":{"code":"invalid_credentials"}}' }))
    await page.getByRole('button', { name: 'دخول', exact: true }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByLabel('اسم المستخدم')).toHaveValue('admin')
  })

  test('the MFA branch keeps its code field and translated invalid-code alert', async ({ page }) => {
    let loginCalls = 0
    let totpCalls = 0
    await page.route('**/api/auth/login', route => {
      loginCalls++
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"mfa":"totp"}' })
    })
    await page.route('**/api/auth/totp', route => {
      totpCalls++
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
    })
    await page.goto('/login')
    await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeEnabled()
    await page.locator('#login').fill('admin')
    await page.locator('#password').fill('mock-secret')
    await page.getByRole('button', { name: 'دخول', exact: true }).click()
    await expect(page.locator('#totp-code')).toBeVisible()
    await page.locator('#totp-code').fill('123456')
    await page.getByRole('button', { name: 'متابعة', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('رمز التحقق غير صحيح')
    expect(loginCalls).toBe(1)
    expect(totpCalls).toBe(1)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  })

  test('on a 390px phone the card fits the width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/login')
    await expect(page.getByLabel('اسم المستخدم')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
