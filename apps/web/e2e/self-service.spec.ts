import { expect, test } from '@playwright/test'
import { login, open, fitsWidth, PHONE } from './support/tasmim6'

test.skip(process.env.E2E_SELF_SERVICE !== '1', 'Requires an isolated fixture with an unlinked E2E_ADMIN_LOGIN account')

// The isolated development fixture uses an administrator without an employee link.
// Own-record authorization is covered by the Odoo tests; these pin the real shell/routes.
test.beforeEach(async ({ page }) => { await login(page) })

test('the account entry opens Self-service and card order survives reload without moving the sidebar', async ({ page }) => {
  await open(page, '/projects')
  await page.getByTestId('account-menu').click()
  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByRole('heading', { level: 1, name: 'الخدمة الذاتية' })).toBeVisible()
  const cards = page.locator('[data-testid^="personal-card-"]')
  const order = await cards.evaluateAll(elements => elements.map(element => element.getAttribute('data-testid')))
  expect(order.length).toBeGreaterThan(1)
  const nav = page.getByRole('navigation', { name: 'الخدمة الذاتية' })
  await expect(nav.getByRole('link', { name: 'الملخص', exact: true })).toBeVisible()
  const sidebar = await nav.locator('a').allTextContents()
  await page.getByRole('button', { name: 'ترتيب البطاقات', exact: true }).click()
  await cards.first().getByRole('button', { name: /تأخير/ }).click()
  await expect(cards.first()).toHaveAttribute('data-testid', order[1]!)
  await page.reload()
  await expect(cards.first()).toHaveAttribute('data-testid', order[1]!)
  expect(await nav.locator('a').allTextContents()).toEqual(sidebar)
})

test('overview leave creation returns to its origin and a direct form returns to the leave list', async ({ page }) => {
  await open(page, '/account')
  await page.getByTestId('personal-card-leave').getByRole('link', { name: 'طلب إجازة', exact: true }).click()
  await expect(page).toHaveURL(/\/account\/leave\/new\?returnTo=(?:%2F|\/)account$/)
  await page.getByRole('dialog').getByRole('button', { name: 'إغلاق', exact: true }).click()
  await expect(page).toHaveURL(/\/account$/)
  await open(page, '/account/leave/new')
  await page.getByRole('dialog').getByRole('button', { name: 'إغلاق', exact: true }).click()
  await expect(page).toHaveURL(/\/account\/leave$/)
})

test('personal sections explain missing employee linkage and keep the Self-service sidebar on refresh', async ({ page }) => {
  expect(await (await page.request.get('/api/v1/hr/me')).json(), 'Requires the unlinked scratch employee fixture').toBeNull()
  for (const path of ['profile', 'leave', 'pay', 'assets', 'documents', 'schedule']) {
    await open(page, `/account/${path}`)
    await expect(page.getByText(/لا يوجد ملف موظف مرتبط بحسابك|حسابك غير مرتبط بسجل موظف/)).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'الخدمة الذاتية', exact: true })).toBeVisible()
  }
  await page.reload()
  await expect(page.getByText(/لا يوجد ملف موظف مرتبط بحسابك|حسابك غير مرتبط بسجل موظف/)).toBeVisible()
})

test('Self-service fits a phone and account preferences retain Arabic and English navigation', async ({ page }) => {
  await page.setViewportSize(PHONE)
  await open(page, '/account')
  expect(await fitsWidth(page)).toBe(true)
  await page.getByTestId('shell-main').getByRole('link', { name: 'إعدادات حسابي', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'إعدادات حسابي' })).toBeVisible()
  await page.getByRole('radio', { name: 'English', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await page.getByRole('link', { name: 'Self-service', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Self-service' })).toBeVisible()
  expect(await fitsWidth(page)).toBe(true)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Self-service' })).toBeVisible()
})
