import { expect, test } from '@playwright/test'
import { enterFoundation } from './support/uxFoundations'

test('foundation home is the personal day page: indicators and the top of my work, no grid of destinations', async ({ page }) => {
  await enterFoundation(page, '/')
  await expect(page.getByTestId('foundation-home')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('يومي')
  await expect(page.getByTestId('module-rail').locator('a[data-active="true"]')).toHaveAttribute('href', '/')
  await expect(page.getByTestId('context-sidebar')).toHaveCount(0)
  await expect(page.getByTestId('foundation-home').locator('[data-slot="link-card"]')).toHaveCount(0)
  // The shared mock identity has no Tasks capability, so the indicators (which open `/work`) are hidden here; their links are covered by the home page unit tests.
  await expect(page.getByText('الوصول السريع')).toBeVisible()
})

test('tablet defaults collapse before interaction and only explicit toggles persist across resize and refresh', async ({ page, context }) => {
  await page.setViewportSize({ width: 768, height: 1000 })
  await enterFoundation(page, '/projects')
  const sidebar = page.getByTestId('context-sidebar')
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(64)
  expect((await context.cookies()).find(cookie => cookie.name === 'webvue-context-sidebar')).toBeUndefined()
  await page.getByTestId('context-sidebar-toggle').click()
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.reload()
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')
  await page.getByTestId('context-sidebar-toggle').click()
  await page.setViewportSize({ width: 1099, height: 1000 })
  await page.reload()
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(64)
})

for (const width of [767, 1100]) {
  test(`navigation at ${width}px uses the expected surface`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await enterFoundation(page, '/projects')
    if (width < 768) {
      await expect(page.getByTestId('module-rail')).toBeHidden()
      const menu = page.getByRole('button', { name: /فتح القائمة|فتح التنقل|التنقل/ }).first()
      await expect(menu).toBeVisible()
    } else {
      await expect(page.getByTestId('context-sidebar')).toHaveAttribute('data-expanded', 'true')
    }
  })
}

test('an internal account without application features can use Home without protected destinations', async ({ page }) => {
  await page.route('**/api/v1/me', async route => {
    const response = await route.fetch()
    const me = await response.json()
    await route.fulfill({ response, json: { ...me, capabilities: [], modules: [], entitlements: {}, platform: { ...me.platform, readable_features: [], writable_features: [] } } })
  })
  await enterFoundation(page, '/account')
  await page.getByTestId('module-rail').locator('.webvue-module-rail-brand').click()
  await expect(page.getByTestId('foundation-home')).toContainText('لا توجد مساحات عمل')
  // Only Launcher and Today remain when the user cannot reach any applications.
  await expect(page.getByTestId('module-rail').locator('.webvue-module-rail-link')).toHaveCount(2)
  await expect(page.getByTestId('foundation-home').locator('a[href^="/projects"]')).toHaveCount(0)
})

test('a deliberate shell visit starts at top even for the same list path or an active link', async ({ page }) => {
  await enterFoundation(page, '/projects?q=مهمة')
  await page.evaluate(() => { document.body.style.minHeight = '4000px'; window.scrollTo(0, 600) })
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600)
  await page.evaluate(() => (document.querySelector('.webvue-module-rail-link[href="/projects"]') as HTMLElement).click())
  await expect(page).toHaveURL(/\/projects$/)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await page.evaluate(() => window.scrollTo(0, 500))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(500)
  await page.evaluate(() => (document.querySelector('.webvue-module-rail-link[href="/projects"]') as HTMLElement).click())
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
})

test.describe('mobile drawer entry', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  test('an active drawer destination starts a fresh list visit', async ({ page }) => {
    await enterFoundation(page, '/projects')
    await page.evaluate(() => { document.body.style.minHeight = '4000px'; window.scrollTo(0, 600) })
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600)
    await page.getByTestId('mobile-navigation-trigger').click()
    const dialog = page.getByRole('dialog')
    const projects = dialog.getByRole('navigation', { name: 'الموديولات', exact: true }).getByRole('link', { name: 'المشاريع', exact: true })
    const box = (await projects.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    await projects.click()
    await expect(dialog).toBeHidden()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  })
})
