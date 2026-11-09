import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { expectAlignedGuide } from './helpers/navigationGeometry'

test.setTimeout(90_000)
async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled({ timeout: 30_000 })
}

test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { login: process.env.E2E_ADMIN_LOGIN ?? 'admin', password: process.env.E2E_ADMIN_PASSWORD ?? 'admin' } })).status()).toBe(200)
})

// Branches open and close on their own button, without navigating, and each one keeps its own state.
test('HR areas open as independent branches without navigating on expansion', async ({ page }) => {
  await open(page, '/hr')
  const menu = page.getByTestId('application-navigation')
  await expect(menu.getByTestId('context-link-section-people')).toHaveAttribute('aria-expanded', 'true')
  await expect(menu.getByTestId('context-link-employees')).toHaveAttribute('href', '/hr')
  await menu.getByTestId('context-link-section-hiring').click()
  await expect(menu.getByTestId('context-link-section-hiring')).toHaveAttribute('aria-expanded', 'true')
  await expect(menu.getByTestId('context-link-section-people')).toHaveAttribute('aria-expanded', 'true')
  await expect(menu.getByTestId('context-link-recruitment-jobs')).toHaveAttribute('href', '/hr/recruitment/jobs')
  await expect(page).toHaveURL(/\/hr$/)
  await menu.getByTestId('context-link-section-people').click()
  await expect(menu.getByTestId('context-link-section-people')).toHaveAttribute('aria-expanded', 'false')
  await expect(menu.getByTestId('context-link-employees')).toHaveCount(0)
  await menu.getByTestId('context-link-section-time').click()
  await expect(menu.getByTestId('context-link-shifts')).toHaveAttribute('href', '/hr/shifts')
  await expect(menu.getByTestId('context-link-section-hiring')).toHaveAttribute('aria-expanded', 'true')
})

test('finance groups retain sales, purchase and report destinations', async ({ page }) => {
  await open(page, '/finance/sales/invoices')
  const menu = page.getByTestId('application-navigation')
  await expect(menu.getByTestId('context-link-finance-sales')).toHaveAttribute('aria-expanded', 'true')
  await expect(menu.getByTestId('context-link-sales-customers')).toHaveAttribute('href', '/finance/partners?kind=customer')
  await menu.getByTestId('context-link-finance-purchases').click()
  await expect(menu.getByTestId('context-link-finance-sales')).toHaveAttribute('aria-expanded', 'true')
  await expect(page).toHaveURL(/\/finance\/sales\/invoices$/)
  await expect(menu.getByTestId('context-link-purchases-vendors')).toHaveAttribute('href', '/finance/partners?kind=vendor')
  await menu.getByTestId('context-link-finance-reports').click()
  await expect(menu.getByTestId('context-link-report-vat')).toHaveAttribute('href', '/finance/reports/vat')
  await menu.getByTestId('context-link-sales-customers').click()
  await expect(page).toHaveURL(/\/finance\/partners\?kind=customer$/)
  await expect(menu.getByTestId('context-link-finance-sales')).toHaveAttribute('aria-expanded', 'true')
  await expect(menu.getByTestId('context-link-sales-customers')).toHaveAttribute('data-active', 'true')
  await expect(menu.getByTestId('context-link-finance-partners')).not.toHaveAttribute('data-active', 'true')
})

test('settings nested branches keep anchors, filters and library-owned controls', async ({ page }) => {
  await open(page, '/settings/team/users')
  const menu = page.getByTestId('application-navigation')
  const team = menu.getByTestId('context-link-settings-team')
  const users = menu.getByRole('button', { name: 'المستخدمون', exact: true })
  await expect(team).toHaveAttribute('aria-expanded', 'true')
  await expect(users).toHaveAttribute('aria-expanded', 'true')
  await expect(menu.getByTestId('sidebar-settings-overview')).toHaveAttribute('href', '/settings/team#users')
  await menu.getByTestId('quick-view-stopped').click()
  await expect(page).toHaveURL(/\/settings\/team\/users\?status=stopped$/)
  await expect(menu.getByTestId('quick-view-stopped')).toHaveAttribute('data-active', 'true')
  await users.press('Enter')
  await expect(users).toHaveAttribute('aria-expanded', 'false')
  await expect(team).toHaveAttribute('aria-expanded', 'true')
  await menu.getByTestId('context-link-settings-company').click()
  await expect(menu.getByTestId('context-link-settings-company')).toHaveAttribute('aria-expanded', 'true')
  await expect(team).toHaveAttribute('aria-expanded', 'true')
  await expect(menu.getByTestId('settings-branding-tab')).toHaveAttribute('href', '/settings/company#branding')
  await expect(page).toHaveURL(/status=stopped/)
})

test('nested HR navigation works in the mobile drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page, '/hr')
  await page.getByTestId('mobile-navigation-trigger').click()
  const menu = page.locator('#mobile-navigation')
  await menu.getByTestId('mobile-context-link-section-hiring').click()
  await expect(menu.getByTestId('mobile-context-link-recruitment')).toBeVisible()
  await expect(menu.getByTestId('mobile-context-link-section-people')).toHaveAttribute('aria-expanded', 'true')
  await expect(page).toHaveURL(/\/hr$/)
  await menu.getByTestId('mobile-context-link-recruitment').click()
  await expect(page).toHaveURL(/\/hr\/recruitment$/)
  await expect(menu).toBeHidden()
})

test('the sidebar is one full-height column, with no panel of its own for chat', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await open(page, '/chat?filter=channels')
  const menu = page.getByTestId('application-navigation')
  const box = (await menu.boundingBox())!
  expect(box.y).toBe(0)
  expect(box.height).toBe(900)
  await expect(menu).toHaveAttribute('data-mode', 'app')
  await expect(menu.getByTestId('context-link-chat')).toHaveAttribute('data-active', 'true')
})

for (const width of [360, 1440]) {
  for (const locale of ['ar', 'en']) {
    test(`nested settings guides fit at ${width}px in ${locale}`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.context().addCookies([{ name: 'liwan-locale', value: locale, url: baseURL! }])
      expect((await page.request.patch('/api/v1/me/appearance', { data: { mode: 'dark', font_size: 'large' } })).status()).toBe(200)
      try {
        await open(page, '/settings/team/users?status=stopped')
        await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
        let menu = page.getByTestId('application-navigation')
        let prefix = ''
        if (width < 768) {
          await page.getByTestId('mobile-navigation-trigger').click()
          menu = page.locator('#mobile-navigation')
          prefix = 'mobile-'
        }
        const parent = menu.getByTestId(`${prefix}context-link-settings-team`)
        const users = menu.getByRole('button', { name: locale === 'ar' ? 'المستخدمون' : 'Users', exact: true })
        await expect(users).toHaveAttribute('aria-expanded', 'true')
        await expectAlignedGuide(parent)
        await expectAlignedGuide(users)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
        expect(await menu.locator('.liwan-side-branch [data-slot="label"]').evaluateAll(labels => labels.every(label => {
          const text = label.getBoundingClientRect()
          const row = label.closest('.liwan-side-row')!.getBoundingClientRect()
          return text.left >= row.left - 1 && text.right <= row.right + 1
        }))).toBe(true)
        await users.click()
        await expect(users).toHaveAttribute('aria-expanded', 'false')
        await expect(parent).toHaveAttribute('aria-expanded', 'true')
      } finally {
        await page.request.patch('/api/v1/me/appearance', { data: { mode: 'light', font_size: 'small' } })
      }
    })
  }
}

test('between 768px and 1099px the sidebar is an icon-only 84px column, and the flat projects menu has no branch at all', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 })
  await open(page, '/projects')
  const menu = page.getByTestId('application-navigation')
  expect((await menu.boundingBox())!.width).toBe(84)
  await expect(menu.getByTestId('context-link-projects')).toBeVisible()
  await expect(menu.locator('.liwan-side-branch')).toHaveCount(0)
  await expect(menu.getByTestId('navigation-app-block').locator('[data-slot="name"]')).toBeHidden()
  await expect(menu.getByTestId('context-link-project-dashboard')).toHaveAccessibleName('نظرة عامة')
})

test('meetings share the hierarchy and documents without archive access stay direct', async ({ page }) => {
  for (const path of ['/meetings', '/documents']) {
    await open(page, path)
    const menu = page.getByTestId('application-navigation')
    if (path === '/documents') {
      // This mock identity may read/manage documents, but may not archive them.
      await expect(menu.getByTestId('context-link-documents')).toHaveAttribute('href', path)
      await expect(menu.getByTestId('context-link-documents')).toHaveAttribute('data-active', 'true')
      await expect(menu.locator('button[aria-expanded]')).toHaveCount(0)
      continue
    }
    const parentId = await menu.locator('button[aria-expanded="true"]').first().getAttribute('data-testid')
    const parent = menu.getByTestId(parentId!)
    await expect(parent).toBeVisible()
    await expectAlignedGuide(parent)
    await expect(menu.locator(`.liwan-side-branch a[href="${path}"]`)).toBeVisible()
    const originalUrl = page.url()
    await parent.click()
    await expect(parent).toHaveAttribute('aria-expanded', 'false')
    await expect(page).toHaveURL(originalUrl)
  }
})
