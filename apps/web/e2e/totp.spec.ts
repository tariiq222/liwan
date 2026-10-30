import { test, expect } from '@playwright/test'

// The real TOTP verification path (enabling 2FA, checking the code against the
// secret) is covered server-side by the Odoo test in liwan_api/tests/test_totp.py.
// This spec only exercises the UI branch: given the Nitro endpoints, does the
// second step render, submit, and navigate on success.
for (const destination of [
  { name: 'foundation home', login: '/login', expected: /\/$/ },
  { name: 'authorized return path', login: '/login?next=/tasks', expected: /\/tasks$/ },
]) {
  test(`MFA-pending login submits the TOTP step to ${destination.name}`, async ({ page }) => {
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, mfa: 'totp' }) }))
    await page.route('**/api/auth/totp', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
    await page.route('**/api/v1/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 1, name: 'Admin', login: 'admin', email: '', lang: 'ar_001', tz: '',
          role: 'admin', company: { id: 1, name: 'liwan' },
          roles: [], capabilities: ['pmo.tasks.read'], access_policy_version: 1,
          modules: ['liwan_pmo'],
          entitlements: { 'pmo.enabled': true },
          platform: {
            schema_version: 1, policy_revision: 1, state: 'active',
            valid_until: null, read_only: false,
            readable_features: ['pmo.enabled'], writable_features: ['pmo.enabled'],
          },
          terminology: { ar: {}, en: {} },
        }),
      }))

    await page.goto(destination.login)
    await page.getByLabel('اسم المستخدم').fill('admin')
    await page.getByLabel('كلمة المرور').fill('admin')
    await page.getByRole('button', { name: 'دخول' }).click()

    await expect(page.getByText('رمز التحقق')).toBeVisible()
    await page.getByLabel('رمز التحقق').fill('123456')
    await page.getByRole('button', { name: 'متابعة' }).click()

    await expect(page).toHaveURL(destination.expected)
  })
}
