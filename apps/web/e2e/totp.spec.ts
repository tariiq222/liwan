import { test, expect } from '@playwright/test'

// The real second-step verification (a hashed code, its expiry and attempt cap) is covered
// server-side by odoo-addons/liwan_api/tests/test_login_code_routes.py. This spec exercises the UI
// branch: given the Nitro endpoints, does the second step render, submit and navigate on success.
const ME = {
  id: 1, name: 'Admin', login: 'admin', email: '', lang: 'ar_001', tz: '',
  role: 'admin', company: { id: 1, name: 'liwan' }, companies: [{ id: 1, name: 'liwan' }], home_company_id: 1, mobile: null, mobile_required: false,
  roles: [], capabilities: ['pmo.tasks.read'], home_capabilities: ['pmo.tasks.read'], access_policy_version: 1,
  modules: ['liwan_pmo'],
  entitlements: { 'pmo.enabled': true },
  platform: {
    schema_version: 1, policy_revision: 1, state: 'active',
    valid_until: null, read_only: false,
    readable_features: ['pmo.enabled'], writable_features: ['pmo.enabled'],
  },
  terminology: { ar: {}, en: {} },
}

for (const destination of [
  { name: 'foundation home', login: '/login', expected: /\/$/ },
  { name: 'authorized return path', login: '/login?next=/tasks', expected: /\/tasks$/ },
]) {
  test(`two-step login sends and submits a code to ${destination.name}`, async ({ page }) => {
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, mfa: 'code' }) }))
    await page.route('**/api/auth/channels', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ channels: ['sms', 'email'], sms_available: true, has_mobile: true, has_email: true }),
      }))
    await page.route('**/api/auth/code', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ channel: 'sms', destination: '***011', resend_after: 60 }),
      }))
    await page.route('**/api/auth/verify', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...ME, remembered: false }),
      }))
    await page.route('**/api/v1/me', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ME) }))

    await page.goto(destination.login)
    await page.getByLabel('اسم المستخدم').fill('admin')
    await page.getByLabel('كلمة المرور').fill('admin')
    await page.getByRole('button', { name: 'دخول' }).click()

    // The channel chooser appears first (no destination exists yet), the send answer names the masked
    // destination, and then the code field is ready.
    await expect(page.getByTestId('login-channel-sms')).toBeVisible()
    await page.getByTestId('login-send').click()
    await expect(page.getByTestId('login-destination')).toContainText('***011')
    await page.getByTestId('login-code').fill('123456')
    await page.getByRole('button', { name: 'تحقق' }).click()

    await expect(page).toHaveURL(destination.expected)
  })
}
