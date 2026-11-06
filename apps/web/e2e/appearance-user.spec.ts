import { expect, test } from '@playwright/test'

// Real Odoo only: it signs in as two accounts tools/e2e_seed.py creates (the mock answers 404), one after the other in
// the same browser. Not in ci-mock-specs.txt, and not yet in the e2e-odoo list (it has not been run on a scratch Odoo).
test.skip(process.env.E2E_REAL_ODOO !== '1', 'Explicit isolated real Odoo acceptance only')

const FIRST = { login: 'e2e_admin', password: process.env.E2E_USER_ADMIN_PASSWORD ?? process.env.E2E_ADMIN_PASSWORD ?? 'liwan-e2e-admin-2026' }
const SECOND = { login: 'e2e_staff1', password: process.env.E2E_USER_STAFF1_PASSWORD ?? 'liwan-e2e-staff1-2026' }

async function login(page: import('@playwright/test').Page, account: { login: string; password: string }) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill(account.login)
  await page.getByLabel('كلمة المرور').fill(account.password)
  const authenticated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  expect((await authenticated).status()).toBe(200)
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
}

test('the saved appearance belongs to the signed-in user, not the browser', async ({ page }) => {
  await login(page, FIRST)
  await page.request.patch('/api/v1/me/appearance', { data: { mode: 'dark', font_size: 'large' } })
  await page.goto('/projects')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.locator('html')).toHaveCSS('font-size', '18px')
  // Another user on the same browser starts from their own (default) preference.
  await page.goto('/account/settings')
  await page.getByRole('button', { name: 'تسجيل الخروج' }).click()
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel('اسم المستخدم').fill(SECOND.login)
  await page.getByLabel('كلمة المرور').fill(SECOND.password)
  const authenticated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  expect((await authenticated).status()).toBe(200)
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(page.locator('html')).toHaveCSS('font-size', '14px')
})

