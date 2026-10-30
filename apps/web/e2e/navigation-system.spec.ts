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

test('HR areas use the same exclusive submenu without navigating on expansion', async ({ page }) => {
  await open(page, '/hr')
  const menu = page.getByTestId('application-navigation')
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
  await expect(menu.locator('h2 button')).toHaveCount(0)
  await expect(menu.getByTestId('context-link-section-people')).toHaveAttribute('aria-expanded', 'true')
  await expect(menu.getByTestId('hr-context-link-employees')).toHaveAttribute('href', '/hr')
  await menu.getByTestId('context-link-section-hiring').click()
  await expect(menu.getByTestId('context-link-section-people')).toHaveAttribute('aria-expanded', 'false')
  await expect(menu.getByTestId('hr-context-link-recruitment-jobs')).toHaveAttribute('href', '/hr/recruitment/jobs')
  await expect(page).toHaveURL(/\/hr$/)
  await menu.getByTestId('context-link-section-time').click()
  await expect(menu.getByTestId('context-link-section-hiring')).toHaveAttribute('aria-expanded', 'false')
  await expect(menu.getByTestId('hr-context-link-shifts')).toHaveAttribute('href', '/hr/shifts')
})

test('finance groups retain sales, purchase and report destinations', async ({ page }) => {
  await open(page, '/finance/sales/invoices')
  const menu = page.getByTestId('application-navigation')
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
  await expect(menu.getByTestId('context-link-finance-sales')).toHaveAttribute('aria-expanded', 'true')
  await expect(menu.getByTestId('finance-context-link-sales-customers')).toHaveAttribute('href', '/finance/partners?kind=customer')
  await menu.getByTestId('context-link-finance-purchases').click()
  await expect(menu.getByTestId('context-link-finance-sales')).toHaveAttribute('aria-expanded', 'false')
  await expect(page).toHaveURL(/\/finance\/sales\/invoices$/)
  await expect(menu.getByTestId('finance-context-link-purchases-vendors')).toHaveAttribute('href', '/finance/partners?kind=vendor')
  await menu.getByTestId('context-link-finance-reports').click()
  await expect(menu.getByTestId('context-link-finance-purchases')).toHaveAttribute('aria-expanded', 'false')
  await expect(menu.getByTestId('finance-context-link-report-vat')).toHaveAttribute('href', '/finance/reports/vat')
  await menu.getByTestId('context-link-finance-sales').click()
  await menu.getByTestId('finance-context-link-sales-customers').click()
  await expect(page).toHaveURL(/\/finance\/partners\?kind=customer$/)
  await expect(menu.getByTestId('context-link-finance-sales')).toHaveAttribute('aria-expanded', 'true')
  await expect(menu.getByTestId('finance-context-link-sales-customers')).toHaveAttribute('data-active', 'true')
  await expect(menu.getByTestId('context-link-finance-partners')).toHaveAttribute('data-active', 'false')
})

test('settings nested branches keep anchors, filters and library-owned controls', async ({ page }) => {
  await open(page, '/settings/team/users')
  const menu = page.getByTestId('application-navigation')
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
  const team = menu.getByTestId('context-link-settings-team')
  const users = menu.getByRole('button', { name: 'المستخدمون', exact: true })
  await expect(team).toHaveAttribute('aria-expanded', 'true')
  await expect(users).toHaveAttribute('aria-expanded', 'true')
  await expect(menu.getByTestId('settings-sidebar-settings-overview')).toHaveAttribute('href', '/settings/team#users')
  await menu.getByTestId('settings-quick-view-stopped').click()
  await expect(page).toHaveURL(/\/settings\/team\/users\?status=stopped$/)
  await expect(menu.getByTestId('settings-quick-view-stopped')).toHaveAttribute('data-active', 'true')
  await users.press('Enter')
  await expect(users).toHaveAttribute('aria-expanded', 'false')
  await expect(team).toHaveAttribute('aria-expanded', 'true')
  await menu.getByTestId('context-link-settings-company').click()
  await expect(team).toHaveAttribute('aria-expanded', 'false')
  await expect(menu.getByTestId('settings-settings-branding-tab')).toHaveAttribute('href', '/settings/company#branding')
  await expect(page).toHaveURL(/status=stopped/)
})

test('nested HR navigation works in the mobile drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page, '/hr')
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
  await page.getByTestId('mobile-navigation-trigger').click()
  const menu = page.locator('#mobile-navigation')
  await menu.getByTestId('context-link-section-hiring').click()
  await expect(menu.getByTestId('mobile-hr-context-link-recruitment')).toBeVisible()
  await expect(menu.getByTestId('context-link-section-people')).toHaveAttribute('aria-expanded', 'false')
  await expect(page).toHaveURL(/\/hr$/)
  await menu.getByTestId('mobile-hr-context-link-recruitment').click()
  await expect(page).toHaveURL(/\/hr\/recruitment$/)
  await expect(menu).toBeHidden()
})

test('chat retains full-height panel after shared navigation changes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await open(page, '/chat?filter=channels')
  const menu = page.getByTestId('application-navigation')
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
  await expect(menu).toHaveAttribute('data-panel-width', 'wide')
  const box = (await menu.boundingBox())!
  expect(box.y + box.height).toBeCloseTo(888, 0)
  await expect(menu.locator('.liwan-navigation-panel')).toBeVisible()
})

for (const width of [360, 768, 1440]) {
  for (const locale of ['ar', 'en']) {
    test(`nested settings guides fit at ${width}px in ${locale} with reduced motion`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.context().addCookies([{ name: 'liwan-locale', value: locale, url: baseURL! }])
      expect((await page.request.patch('/api/v1/me/appearance', { data: { mode: 'dark', font_size: 'large' } })).status()).toBe(200)
      try {
        await open(page, '/settings/team/users?status=stopped')
        await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
        let menu = page.getByTestId('application-navigation')
        if (width < 768) {
          await page.getByTestId('mobile-navigation-trigger').click()
          menu = page.locator('#mobile-navigation')
        } else if (await menu.getAttribute('data-expanded') === 'false') {
          await page.getByTestId('context-sidebar-toggle').click()
        }
        const parent = menu.getByTestId('context-link-settings-team')
        const users = menu.getByRole('button', { name: locale === 'ar' ? 'المستخدمون' : 'Users', exact: true })
        await expect(users).toHaveAttribute('aria-expanded', 'true')
        await expectAlignedGuide(parent)
        await expectAlignedGuide(users)
        await expect(menu.locator('.liwan-navigation-submenu [data-active="true"] .liwan-quick-chip')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
        expect(await menu.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
        expect(await menu.locator('.liwan-navigation-submenu [data-slot="label"]').evaluateAll(labels => labels.every(label => {
          const text = label.getBoundingClientRect()
          const row = label.closest('.liwan-quick-link')!.getBoundingClientRect()
          return text.left >= row.left - 1 && text.right <= row.right + 1
        }))).toBe(true)
        await users.click()
        await expect(users).toHaveAttribute('aria-expanded', 'false')
        const controlledId = await users.getAttribute('aria-controls')
        await expect(page.locator(`[id="${controlledId}"]`)).toHaveCSS('animation-name', 'none')
        await expect(parent).toHaveAttribute('aria-expanded', 'true')
      } finally {
        await page.request.patch('/api/v1/me/appearance', { data: { mode: 'light', font_size: 'small' } })
      }
    })
  }
}

test('meetings share the hierarchy and documents without archive access stay direct', async ({ page }) => {
  for (const path of ['/meetings', '/documents']) {
    await open(page, path)
    const menu = page.getByTestId('application-navigation')
    if (path === '/documents') {
      // This mock identity may read/manage documents, but may not archive them.
      await expect(menu.getByTestId('context-link-documents')).toHaveAttribute('href', path)
      await expect(menu.getByTestId('context-link-documents')).toHaveAttribute('data-active', 'true')
      await expect(menu.locator('.liwan-submenu-trigger')).toHaveCount(0)
      continue
    }
    const parentId = await menu.locator('.liwan-submenu-trigger[aria-expanded="true"]').first().getAttribute('data-testid')
    const parent = menu.getByTestId(parentId!)
    await expect(parent).toBeVisible()
    await expectAlignedGuide(parent)
    await expect(menu.locator(`.liwan-navigation-submenu a[href="${path}"]`)).toBeVisible()
    const originalUrl = page.url()
    await parent.click()
    await expect(parent).toHaveAttribute('aria-expanded', 'false')
    await expect(page).toHaveURL(originalUrl)
  }
})
