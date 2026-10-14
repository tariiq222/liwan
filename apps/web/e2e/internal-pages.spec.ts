import { expect, test } from '@playwright/test'

const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'

async function login(page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill(ADMIN_LOGIN)
  await page.getByLabel('كلمة المرور').fill(ADMIN_PASSWORD)
  const authenticated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'دخول' }).click()
  expect((await authenticated).status()).toBe(200)
  // Login lands on the first section the user may open (accessPolicy.firstAllowedPath).
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
}

test('global search is a reloadable page with no overlay layer', async ({ page }) => {
  await login(page)
  await page.goto('/search?returnTo=/tasks')
  await expect(page).toHaveURL(/\/search\?returnTo=/)
  await expect(page.getByRole('heading', { name: 'بحث' })).toBeVisible()
  await expect(page.getByPlaceholder('اكتب للانتقال…')).toBeFocused()
  await expect(page.locator('[data-slot="dialog-content"], [data-slot="sheet-content"], [data-slot="dialog-overlay"], [data-slot="sheet-overlay"]')).toHaveCount(0)

  await page.reload()
  await expect(page.getByTestId('search-page')).toBeVisible()
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
  await expect(page.getByPlaceholder('اكتب للانتقال…')).toBeFocused()
})

test('header search stays a centered popup and does not replace the current route', async ({ page }) => {
  await login(page)
  await page.goto('/tasks?q=kept-search')
  await page.getByRole('button', { name: 'بحث', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'بحث', exact: true })
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(/\/tasks\?q=kept-search/)
  await expect(dialog.getByRole('textbox')).toBeFocused()
})

test('HR and projects index pages survive direct navigation and reload', async ({ page }) => {
  await login(page)

  await page.goto('/hr')
  await expect(page).toHaveURL(/\/hr$/)
  await expect(page.getByRole('heading', { name: 'دليل الموظفين' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'دليل الموظفين' })).toBeVisible()

  await page.goto('/projects')
  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.getByRole('heading', { name: 'كل المشاريع', exact: true, level: 1 })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'كل المشاريع', exact: true, level: 1 })).toBeVisible()

  await expect(page.locator('[data-slot="dialog-content"], [data-slot="sheet-content"], [data-slot="dialog-overlay"], [data-slot="sheet-overlay"]')).toHaveCount(0)
})

test('mobile navigation opens one drawer and closes after route navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)

  const toggle = page.getByTestId('mobile-navigation-trigger')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toHaveAttribute('aria-controls', 'mobile-navigation')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const mobileNav = page.locator('#mobile-navigation')
  await expect(mobileNav).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'القائمة', exact: true })).toHaveCount(1)

  await mobileNav.getByRole('navigation', { name: 'الموديولات', exact: true }).getByRole('link', { name: 'المشاريع', exact: true }).click()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(mobileNav).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
})
