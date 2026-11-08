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
  test.beforeEach(async ({ page }) => {
    await login(page)
    await open(page, '/meetings')
  })

  test('the sidebar is in application mode: back row, the open application, its own links only', async ({ page }) => {
    const menu = page.getByTestId('application-navigation')
    await expect(menu).toHaveAttribute('data-mode', 'app')
    await expect(menu.getByTestId('navigation-app-back')).toHaveAttribute('href', '/apps')
    await expect(menu.getByTestId('navigation-app-block')).toHaveText('الاجتماعات')
    // The day and pinned applications belong to the global mode.
    await expect(menu.getByTestId('navigation-app-home')).toHaveCount(0)
    await expect(menu.getByTestId('shell-org')).toHaveCount(0)
    await expect(menu.getByRole('link', { name: 'عرض الكل', exact: true })).toBeVisible()
    const initial = page.url()
    await menu.getByTestId('context-link-meetings').click()
    await expect(menu.getByTestId('quick-view-done')).toHaveCount(0)
    await expect(menu.getByTestId('context-link-meeting-followup')).toBeVisible()
    expect(page.url()).toBe(initial)
    await menu.getByTestId('context-link-meetings').click()
    await expect(menu.getByTestId('quick-view-done')).toBeVisible()
    expect(page.url()).toBe(initial)
    await menu.getByTestId('navigation-app-back').click()
    await expect(page).toHaveURL(/\/apps$/)
    await expect(menu).toHaveAttribute('data-mode', 'global')
  })

  test('child presets navigate and a refresh reopens the branch that owns the route', async ({ page }) => {
    const menu = page.getByTestId('application-navigation')
    await menu.getByTestId('quick-view-done').click()
    await expect(page).toHaveURL(/\/meetings\?state=done$/)
    await page.reload()
    await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
    await expect(menu.getByTestId('submenu-meetings')).toBeVisible()
    const done = menu.getByTestId('quick-view-done')
    await expect(done).toHaveAttribute('data-active', 'true')
    await expect(done).toHaveAttribute('aria-current', 'page')
    await expect(done).toHaveCSS('font-weight', '600')
    expect(await fitsWidth(page)).toBe(true)
  })
})

test.describe('unified mobile navigation', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('expanding a branch keeps the drawer open, selecting a child closes it', async ({ page }) => {
    await login(page); await open(page, '/meetings')
    await expect(page.getByTestId('application-navigation')).toBeHidden()
    await page.getByTestId('mobile-navigation-trigger').click()
    const drawer = page.locator('#mobile-navigation')
    await expect(drawer).toBeVisible()
    await expect(drawer.getByTestId('mobile-navigation-app-block')).toHaveText('الاجتماعات')
    for (const link of await drawer.getByRole('link').all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect(await drawer.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    const done = drawer.getByTestId('mobile-quick-view-done')
    await expect(done).toBeVisible()
    await drawer.getByTestId('mobile-context-link-meetings').click()
    await expect(done).toHaveCount(0)
    await expect(drawer).toBeVisible()
    await drawer.getByTestId('mobile-context-link-meetings').click()
    await done.click()
    await expect(page).toHaveURL(/\/meetings\?state=done$/)
    await expect(drawer).toBeHidden()
    expect(await fitsWidth(page)).toBe(true)
  })

  test('the bottom tab bar replaces the sidebar and «المزيد» is lit on another application', async ({ page }) => {
    await login(page); await open(page, '/meetings')
    const bar = page.getByTestId('shell-tabbar')
    await expect(bar).toBeVisible()
    expect((await bar.boundingBox())!.height).toBeCloseTo(68, 0)
    await expect(page.getByTestId('mobile-navigation-trigger')).toHaveAttribute('data-active', 'true')
    await expect(bar.locator('a[data-active="true"]')).toHaveCount(0)
    for (const tab of await bar.locator('a, button').all()) expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await bar.getByRole('link', { name: 'يومي', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(bar.getByRole('link', { name: 'يومي', exact: true })).toHaveAttribute('data-active', 'true')
    await expect(page.getByTestId('mobile-navigation-trigger')).not.toHaveAttribute('data-active', 'true')
  })
})

test.describe('sidebar modes and widths', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeEach(async ({ page }) => { await login(page) })

  test('the day page shows the global mode: organisation, the day, pinned applications and all applications', async ({ page }) => {
    await open(page, '/')
    const menu = page.getByTestId('application-navigation')
    await expect(menu).toHaveAttribute('data-mode', 'global')
    await expect(menu.getByTestId('shell-org')).toBeVisible()
    await expect(menu.getByTestId('navigation-app-home')).toHaveAttribute('data-active', 'true')
    await expect(menu.getByTestId('navigation-app-projects')).toHaveAttribute('href', '/projects')
    await expect(menu.getByTestId('side-section-action')).toHaveAttribute('href', '/apps')
    await expect(menu.getByTestId('navigation-app-apps')).toHaveAttribute('href', '/apps')
    await expect(menu.getByTestId('navigation-app-block')).toHaveCount(0)
    // The settings row and the account card close the sidebar in both modes.
    await expect(menu.getByTestId('navigation-app-settings')).toBeVisible()
    await expect(menu.getByTestId('account-menu')).toBeVisible()
    await menu.getByTestId('navigation-app-projects').click()
    await expect(page).toHaveURL(/\/projects/)
    await expect(menu).toHaveAttribute('data-mode', 'app')
  })

  test('the sidebar is a fixed 264px column at the inline start', async ({ page }) => {
    await open(page, '/projects')
    const menu = page.getByTestId('application-navigation')
    const box = (await menu.boundingBox())!
    expect(box.width).toBe(264)
    expect(box.y).toBe(0)
    expect(box.height).toBe(900)
    expect(box.x + box.width).toBe(1440)
    await page.evaluate(() => window.scrollTo(0, 400))
    expect((await menu.boundingBox())!.y).toBe(0)
  })

  test('from 768px to 1099px the sidebar is an 84px icon column that keeps accessible names', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 })
    await open(page, '/')
    const menu = page.getByTestId('application-navigation')
    expect((await menu.boundingBox())!.width).toBe(84)
    const projects = menu.getByTestId('navigation-app-projects')
    await expect(projects).toBeVisible()
    await expect(projects).toHaveAccessibleName('المشاريع')
    await expect(projects.locator('[data-slot="label"]')).toBeHidden()
    await expect(menu.getByTestId('shell-org')).toBeHidden()
    expect(await fitsWidth(page)).toBe(true)
  })

  test('under 768px there is no sidebar column and no sidebar-owned width', async ({ page }) => {
    await page.setViewportSize({ width: 767, height: 900 })
    await open(page, '/')
    await expect(page.getByTestId('application-navigation')).toBeHidden()
    await expect(page.getByTestId('shell-tabbar')).toBeVisible()
    expect(await fitsWidth(page)).toBe(true)
  })
})

test.describe('top bar tools and slide-over panels', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeEach(async ({ page }) => {
    await login(page)
    await open(page, '/projects')
  })

  test('the top bar is 68px high, flat and carries the search field and the tools', async ({ page }) => {
    const bar = page.getByTestId('shell-header')
    expect((await bar.boundingBox())!.height).toBeCloseTo(68, 0)
    await expect(bar.getByTestId('global-search-trigger')).toBeVisible()
    await expect(bar.getByTestId('app-switcher')).toBeVisible()
    await expect(bar.getByTestId('theme-toggle')).toBeVisible()
    await expect(bar.getByTestId('notification-bell')).toBeVisible()
    await expect(bar.getByTestId('assistant-button')).toBeVisible()
    await expect(bar.locator('h1')).toHaveCount(0)
  })

  for (const panel of ['notifications', 'chat', 'tasks', 'meetings'] as const) {
    const tool = panel === 'notifications' ? 'notification-bell' : `${panel}-tool`
    test(`${panel}: opens under the bar, closes with Escape and returns focus to its button`, async ({ page }) => {
      const button = page.getByTestId(tool)
      const slide = page.getByTestId(`slide-over-${panel}`)
      await expect(button).toBeEnabled()
      await expect(button).toHaveAttribute('aria-expanded', 'false')
      await button.click()
      await expect(slide).toBeVisible()
      await expect(button).toHaveAttribute('aria-expanded', 'true')
      await expect(button).toHaveAttribute('aria-controls', `slide-over-${panel}`)
      const box = (await slide.boundingBox())!
      expect(box.width).toBeCloseTo(380, 0)
      expect(box.y).toBeGreaterThanOrEqual(68)
      // Not a modal: the page behind keeps working.
      await expect(page.getByTestId('shell-main')).not.toHaveAttribute('inert')
      await expect(slide.getByTestId(`slide-over-${panel}-all`)).toHaveAttribute('href', /^\/\w/)
      await page.keyboard.press('Escape')
      await expect(slide).toBeHidden()
      await expect(button).toBeFocused()
      await expect(button).toHaveAttribute('aria-expanded', 'false')
    })
  }

  test('one panel at a time; a second click on the button, a click outside and the close button all close it', async ({ page }) => {
    const bell = page.getByTestId('notification-bell')
    const tasks = page.getByTestId('tasks-tool')
    await bell.click()
    await expect(page.getByTestId('slide-over-notifications')).toBeVisible()
    await tasks.click()
    await expect(page.getByTestId('slide-over-tasks')).toBeVisible()
    await expect(page.getByTestId('slide-over-notifications')).toBeHidden()
    await tasks.click()
    await expect(page.getByTestId('slide-over-tasks')).toBeHidden()
    await bell.click()
    await page.getByTestId('shell-main').click({ position: { x: 20, y: 200 } })
    await expect(page.getByTestId('slide-over-notifications')).toBeHidden()
    await bell.click()
    await page.getByTestId('slide-over-notifications-close').click()
    await expect(page.getByTestId('slide-over-notifications')).toBeHidden()
    await expect(bell).toBeFocused()
  })

  test('a route change closes the open panel and leaves focus on the page', async ({ page }) => {
    await page.getByTestId('meetings-tool').click()
    await expect(page.getByTestId('slide-over-meetings')).toBeVisible()
    await page.getByTestId('application-navigation').getByTestId('context-link-project-dashboard').click()
    await expect(page.getByTestId('slide-over-meetings')).toBeHidden()
    await expect(page.getByTestId('meetings-tool')).not.toBeFocused()
  })

  test('the assistant panel opens from its button and keeps its content after closing', async ({ page }) => {
    const button = page.getByTestId('assistant-button')
    await button.click()
    const panel = page.getByTestId('slide-over-assistant')
    await expect(panel).toBeVisible()
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(button).toBeFocused()
    // Mounted after the first open, only hidden.
    await expect(panel).toHaveCount(1)
  })

  test('the app switcher lists the reachable applications and opens one', async ({ page }) => {
    await page.getByTestId('app-switcher').click()
    const grid = page.getByTestId('app-switcher-grid')
    await expect(grid).toBeVisible()
    expect(await grid.locator('a').count()).toBeGreaterThan(3)
    await expect(grid.getByTestId('app-switcher-projects')).toHaveAttribute('href', '/projects')
    await expect(grid.getByTestId('app-switcher-settings')).toHaveCount(0)
    await grid.getByTestId('app-switcher-meetings').click()
    await expect(page).toHaveURL(/\/meetings/)
    await expect(grid).toBeHidden()
  })

  test('the theme button flips light and dark', async ({ page }) => {
    const html = page.locator('html')
    const toggle = page.getByTestId('theme-toggle')
    const dark = (await html.getAttribute('class'))?.includes('dark') ?? false
    try {
      await toggle.click()
      if (dark) await expect(html).not.toHaveClass(/dark/)
      else await expect(html).toHaveClass(/dark/)
    } finally {
      await page.request.patch('/api/v1/me/appearance', { data: { mode: 'light', font_size: 'small' } })
    }
  })
})
