import { expect, test } from '@playwright/test'
import { enterFoundation } from './support/uxFoundations'

test('foundation home is the personal day page: indicators and the top of my work, no grid of destinations', async ({ page }) => {
  await enterFoundation(page, '/')
  await expect(page.getByTestId('foundation-home')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('يومي')
  await expect(page.getByTestId('module-rail').locator('a[data-active="true"]')).toHaveAttribute('href', '/')
  await expect(page.getByTestId('application-navigation')).toHaveCount(0)
  await expect(page.getByTestId('foundation-home').locator('[data-slot="link-card"]')).toHaveCount(0)
  await expect(page.getByTestId('home-indicators')).toBeVisible()
  await expect(page.getByTestId('home-focus')).toBeVisible()
  await expect(page.getByText('الوصول السريع')).toBeVisible()
})

test('the menu starts hidden and only an explicit choice persists across resize and refresh', async ({ page, context }) => {
  await page.setViewportSize({ width: 768, height: 1000 })
  await enterFoundation(page, '/projects')
  const sidebar = page.getByTestId('application-navigation')
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')
  await expect(sidebar).toBeHidden()
  expect((await context.cookies()).find(cookie => cookie.name === 'liwan-context-sidebar')).toBeUndefined()
  await page.keyboard.press('BracketLeft')
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.reload()
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')
  await page.getByTestId('context-sidebar-toggle').click()
  await page.setViewportSize({ width: 1099, height: 1000 })
  await page.reload()
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')
  await expect(sidebar).toBeHidden()
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
      await expect(page.getByTestId('application-navigation')).toHaveAttribute('data-expanded', 'false')
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
  await page.getByTestId('module-rail').locator('.liwan-module-rail-brand').click()
  await expect(page.getByTestId('foundation-home')).toContainText('لا توجد مساحات عمل')
  // Only Today remains when the user cannot reach any applications.
  await expect(page.getByTestId('module-rail').locator('.liwan-module-rail-link')).toHaveCount(1)
  await expect(page.getByTestId('foundation-home').locator('a[href^="/projects"]')).toHaveCount(0)
})

test('a deliberate shell visit starts at top even for the same list path or an active link', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'liwan-context-sidebar', value: 'open', url: baseURL! }])
  await enterFoundation(page, '/projects?q=مهمة')
  await page.evaluate(() => { document.body.style.minHeight = '4000px'; window.scrollTo(0, 500) })
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(500)
  await page.evaluate(() => (document.querySelector('.liwan-navigation-children a[href="/projects"]') as HTMLElement).click())
  await expect(page).toHaveURL(/\/projects$/)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await page.evaluate(() => window.scrollTo(0, 500))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(500)
  await page.evaluate(() => (document.querySelector('.liwan-navigation-children a[href="/projects"]') as HTMLElement).click())
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
})

test.describe('mobile drawer entry', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  test('an active drawer destination starts a fresh list visit', async ({ page }) => {
    await enterFoundation(page, '/projects')
    await page.evaluate(() => { document.body.style.minHeight = '4000px'; window.scrollTo(0, 500) })
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(500)
    await page.getByTestId('mobile-navigation-trigger').click()
    const dialog = page.getByRole('dialog')
    const projects = dialog.getByTestId('mobile-application-navigation').getByRole('link', { name: 'عرض الكل', exact: true })
    const box = (await projects.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    await projects.click()
    await expect(dialog).toBeHidden()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  })
})
