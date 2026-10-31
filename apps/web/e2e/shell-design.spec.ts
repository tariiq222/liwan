import { expect, test, type Page } from '@playwright/test'
import { login, fitsWidth } from './support/tasmim6'

test.setTimeout(90_000)
async function open(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled({ timeout: 30_000 })
}

// Run only against the isolated mock stack; this suite does not mutate business records.
test.describe('unified application navigation', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeEach(async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'liwan-context-sidebar', value: 'open', url: baseURL! }])
    await login(page)
    await open(page, '/meetings')
  })

  test('keeps the main application rail and only the current internal menu', async ({ page }) => {
    const menu = page.getByTestId('application-navigation')
    const rail = page.getByTestId('module-rail')
    await expect(rail).toBeVisible()
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('heading', { name: 'الاجتماعات', exact: true })).toBeVisible()
    await expect(menu.locator('h2 button')).toHaveCount(0)
    await expect(menu.getByRole('link', { name: 'الاجتماعات', exact: true })).toHaveCount(0)
    await expect(menu.getByRole('link', { name: 'عرض الكل', exact: true })).toBeVisible()
    await expect(menu.locator('.liwan-navigation-app')).toHaveCount(0)
    const initial = page.url()
    await menu.getByTestId('context-link-meetings').click()
    await expect(menu.getByRole('link', { name: 'مكتمل', exact: true })).not.toBeVisible()
    await expect(menu.getByTestId('context-link-meeting-followup')).toBeVisible()
    expect(page.url()).toBe(initial)
    await menu.getByTestId('context-link-meetings').click()
    await expect(menu.getByRole('link', { name: 'مكتمل', exact: true })).toBeVisible()
    expect(page.url()).toBe(initial)
    await rail.getByRole('link', { name: 'المشاريع', exact: true }).click()
    await expect(page.getByTestId('navigation-submenu-projects')).toBeVisible()
    await expect(page.getByTestId('navigation-submenu-meetings')).toHaveCount(0)
    await expect(rail).toBeVisible()
  })

  test('child presets navigate, refresh reopens the route owner and dots replace rings', async ({ page }) => {
    const menu = page.getByTestId('application-navigation')
    await menu.getByRole('link', { name: 'مكتمل', exact: true }).click()
    await expect(page).toHaveURL(/\/meetings\?state=done$/)
    await page.reload()
    await expect(page.getByTestId('navigation-submenu-meetings')).toBeVisible()
    const chip = menu.getByRole('link', { name: 'مكتمل', exact: true }).locator('.liwan-quick-chip')
    await expect(chip).toHaveCSS('box-shadow', 'none')
    expect(await chip.evaluate(el => getComputedStyle(el, '::before').width)).toBe('8px')
    expect(await fitsWidth(page)).toBe(true)
  })

})

test.describe('unified mobile navigation', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('expanding apps keeps the drawer open, selecting a child closes it', async ({ page }) => {
    await login(page); await open(page, '/meetings')
    await page.getByTestId('mobile-navigation-trigger').click()
    const drawer = page.locator('#mobile-navigation')
    await page.getByTestId('mobile-navigation-app-projects').click()
    await expect(drawer).toBeVisible()
    await expect(page.getByTestId('mobile-navigation-submenu-projects')).toBeVisible()
    await expect(page.getByTestId('mobile-navigation-submenu-meetings')).toHaveCount(0)
    await expect(page).toHaveURL(/\/meetings$/)
    await page.getByTestId('mobile-navigation-app-meetings').click()
    await expect(page.getByTestId('mobile-navigation-submenu-projects')).toHaveCount(0)
    await drawer.getByRole('link', { name: 'مكتمل', exact: true }).click()
    await expect(page).toHaveURL(/\/meetings\?state=done$/)
    await expect(drawer).toBeHidden()
    expect(await fitsWidth(page)).toBe(true)
  })
})

test.describe('hidden application menu', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('takes no room, opens over the page from the rail, and can be kept open', async ({ page, context }) => {
    await context.clearCookies({ name: 'liwan-context-sidebar' })
    await login(page)
    await open(page, '/my-tasks')
    const menu = page.getByTestId('application-navigation')
    const main = page.locator('main').first()
    await expect(menu).toBeHidden()
    const start = (await main.boundingBox())!

    await page.getByTestId('module-rail').getByRole('link', { name: 'مهامي', exact: true }).hover()
    await expect(menu).toBeVisible()
    await expect(menu).toHaveAttribute('data-overlay', 'true')
    expect((await main.boundingBox())!.width).toBe(start.width)

    await page.getByTestId('module-rail').getByRole('link', { name: 'الاجتماعات', exact: true }).hover()
    await expect(menu).toHaveAttribute('aria-label', 'الاجتماعات')
    await page.keyboard.press('Escape')

    await page.getByTestId('module-rail').getByRole('link', { name: 'مهامي', exact: true }).hover()
    await menu.hover()
    await page.getByTestId('context-sidebar-toggle').click()
    await expect(menu).not.toHaveAttribute('data-overlay', 'true')
    await expect.poll(async () => (await menu.boundingBox())!.width).toBe(230)
    await page.mouse.move(800, 500)
    await expect(menu).toBeVisible()
    expect((await main.boundingBox())!.width).toBeLessThan(start.width)
  })
})

test.describe('folded card on a touch device', () => {
  test.use({ viewport: { width: 1024, height: 900 }, isMobile: true, hasTouch: true })
  test.beforeEach(async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'liwan-context-sidebar', value: 'open', url: baseURL! }])
    await login(page)
    await open(page, '/meetings')
  })

  test('collapsed navigation opens only one popup and keeps destinations reachable', async ({ page }) => {
    await page.getByTestId('context-sidebar-toggle').click()
    await expect(page.getByTestId('application-navigation')).toHaveAttribute('data-expanded', 'false')
    await page.getByTestId('navigation-app-meetings').click()
    await expect(page.getByTestId('navigation-submenu-meetings')).toBeVisible()
    await page.getByTestId('module-rail').getByRole('link', { name: 'المشاريع', exact: true }).click()
    await page.getByTestId('navigation-app-projects').click()
    await expect(page.getByTestId('navigation-submenu-projects')).toBeVisible()
    await expect(page.getByTestId('navigation-submenu-meetings')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('navigation-submenu-projects')).toHaveCount(0)
  })
})
