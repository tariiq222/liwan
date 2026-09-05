import { expect, test } from '@playwright/test'

const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'

async function login(page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill(ADMIN_LOGIN)
  await page.getByLabel('كلمة المرور').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
}

test('global search is a reloadable page with no overlay layer', async ({ page }) => {
  await login(page)
  await page.getByTestId('global-search-link').click()
  await expect(page).toHaveURL(/\/search\?returnTo=/)
  await expect(page.getByRole('heading', { name: 'بحث' })).toBeVisible()
  await expect(page.getByPlaceholder('اكتب للانتقال…')).toBeFocused()
  await expect(page.locator('[data-slot="dialog-content"], [data-slot="sheet-content"], [data-slot="dialog-overlay"], [data-slot="sheet-overlay"]')).toHaveCount(0)

  await page.reload()
  await expect(page.getByTestId('search-page')).toBeVisible()
  await expect(page.getByPlaceholder('اكتب للانتقال…')).toBeFocused()
})

test('HR and projects index pages survive direct navigation and reload', async ({ page }) => {
  await login(page)

  await page.goto('/hr')
  await expect(page).toHaveURL(/\/hr$/)
  await expect(page.getByRole('heading', { name: 'الأشخاص' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'الأشخاص' })).toBeVisible()

  await page.goto('/projects')
  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.getByRole('heading', { name: 'المشاريع' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'المشاريع' })).toBeVisible()

  await expect(page.locator('[data-slot="dialog-content"], [data-slot="sheet-content"], [data-slot="dialog-overlay"], [data-slot="sheet-overlay"]')).toHaveCount(0)
})

test('mobile navigation expands inline and closes after route navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)

  const toggle = page.getByRole('button', { name: 'فتح أو إغلاق التنقل' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toHaveAttribute('aria-controls', 'nasq-mobile-navigation')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const mobileNav = page.locator('[data-slot="sidebar-mobile"]')
  await expect(mobileNav).toBeVisible()
  await expect(page.locator('[data-slot="sheet-content"], [data-slot="sheet-overlay"]')).toHaveCount(0)

  await mobileNav.getByRole('link', { name: 'المشاريع' }).click()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(mobileNav).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
})
