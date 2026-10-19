import { test, expect } from '@playwright/test'
for (const width of [390, 768, 1440]) test(`department record links to its document library at ${width}px`, async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { login: process.env.E2E_ADMIN_LOGIN ?? 'admin', password: process.env.E2E_ADMIN_PASSWORD ?? 'admin' } })
  await page.setViewportSize({ width, height: 900 })
  await page.goto('/hr/departments/2')
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page.locator('[data-slot="data-table"]')).toHaveCount(0)
  const link = page.getByRole('link', { name: 'مستندات القسم', exact: true })
  await expect(link).toHaveAttribute('href', '/documents?context_kind=hr.department&context_id=2')
  await link.click()
  await expect(page).toHaveURL(/\/documents\?context_kind=hr.department&context_id=2/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
