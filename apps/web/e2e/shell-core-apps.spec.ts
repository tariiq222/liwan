import { expect, test, type Page } from '@playwright/test'
import { login, fitsWidth } from './support/tasmim6'

test.setTimeout(90_000)
async function open(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled({ timeout: 30_000 })
}

// The core free applications as one icon row under the organisation, in the order the owner asked for.
const CORE = [
  { id: 'home', route: /\/$/, name: 'يومي' },
  { id: 'ai', route: /\/ai$/, name: 'Liwan AI' },
  { id: 'tasks', route: /\/my-tasks$/, name: 'مهامي' },
  { id: 'meetings', route: /\/meetings$/, name: 'الاجتماعات' },
  { id: 'chat', route: /\/chat$/, name: 'المحادثات' },
  { id: 'documents', route: /\/documents$/, name: 'المستندات' },
] as const

test.describe('core apps icon row', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeEach(async ({ page }) => { await login(page) })

  test('lists the six core applications in order under the organisation, each named by its label', async ({ page }) => {
    await open(page, '/apps')
    const menu = page.getByTestId('application-navigation')
    const row = menu.getByTestId('core-apps')
    await expect(row).toBeVisible()
    await expect(row.locator('a')).toHaveCount(CORE.length)
    const ids = await row.locator('a').evaluateAll(links => links.map(link => link.getAttribute('data-testid')))
    expect(ids).toEqual(CORE.map(item => `core-app-${item.id}`))
    for (const item of CORE) await expect(row.getByTestId(`core-app-${item.id}`)).toHaveAccessibleName(new RegExp(`^${item.name}`))
    // The row sits under the organisation card, and no tile wraps: all six share one line.
    const org = (await menu.getByTestId('shell-org').boundingBox())!
    const tops = await row.locator('a').evaluateAll(links => links.map(link => Math.round(link.getBoundingClientRect().top)))
    expect(new Set(tops).size).toBe(1)
    expect(tops[0]!).toBeGreaterThan(org.y + org.height)
    const box = (await row.boundingBox())!
    expect(box.width).toBeLessThanOrEqual(264)
  })

  test('the list «تطبيقاتي» no longer carries the day, the assistant or the free applications', async ({ page }) => {
    await open(page, '/apps')
    const menu = page.getByTestId('application-navigation')
    for (const id of ['home', 'ai', 'tasks', 'meetings', 'chat', 'documents']) await expect(menu.getByTestId(`navigation-app-${id}`)).toHaveCount(0)
    await expect(menu.getByTestId('navigation-app-projects')).toBeVisible()
    await expect(menu.getByTestId('navigation-app-apps')).toBeVisible()
    // The all-applications page offers no pin for a free application.
    for (const card of await page.getByTestId('launcher-row').all()) {
      const app = await card.getAttribute('data-app')
      if (['ai', 'tasks', 'meetings', 'chat', 'documents'].includes(app!)) await expect(card.getByTestId('launcher-pin')).toHaveCount(0)
    }
  })

  for (const item of CORE) {
    test(`${item.id}: a click opens its own full page, not the slide-over, and lights the tile`, async ({ page }) => {
      await open(page, '/apps')
      const menu = page.getByTestId('application-navigation')
      await menu.getByTestId(`core-app-${item.id}`).click()
      await expect(page).toHaveURL(item.route)
      await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
      await expect(menu.getByTestId(`core-app-${item.id}`)).toHaveAttribute('aria-current', 'page')
      await expect(menu.locator('[data-testid^="core-app-"][aria-current="page"]')).toHaveCount(1)
      await expect(page.locator('[data-testid^="slide-over-"]:visible')).toHaveCount(0)
    })
  }

  test('the top-bar tools still open their slide-over panels', async ({ page }) => {
    await open(page, '/projects')
    await page.getByTestId('tasks-tool').click()
    await expect(page.getByTestId('slide-over-tasks')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('slide-over-tasks')).toBeHidden()
  })

  test('a hover shows the name in a tooltip below the tile, with no second description', async ({ page }) => {
    await open(page, '/apps')
    const tile = page.getByTestId('application-navigation').getByTestId('core-app-meetings')
    await tile.hover()
    const tip = page.locator('[role="tooltip"]').filter({ hasText: 'الاجتماعات' })
    await expect(tip).toBeVisible()
    await page.waitForTimeout(200)
    await expect(tile).not.toHaveAttribute('aria-describedby', /.+/)
    const tileBox = (await tile.boundingBox())!
    expect((await tip.boundingBox())!.y).toBeGreaterThan(tileBox.y + tileBox.height - 1)
  })

  test('the row stays in application mode, above the back row and the application menu, with the brand and the organisation', async ({ page }) => {
    await open(page, '/crm')
    const menu = page.getByTestId('application-navigation')
    await expect(menu).toHaveAttribute('data-mode', 'app')
    await expect(menu.locator('.liwan-side-brand')).toBeVisible()
    await expect(menu.getByTestId('shell-org')).toBeVisible()
    await expect(menu.getByTestId('core-apps')).toBeVisible()
    const rowBox = (await menu.getByTestId('core-apps').boundingBox())!
    const backBox = (await menu.getByTestId('navigation-app-back').boundingBox())!
    const blockBox = (await menu.getByTestId('navigation-app-block').boundingBox())!
    expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(backBox.y)
    expect(backBox.y).toBeLessThan(blockBox.y)
    // No tile is lit on an application that is not a core one.
    await expect(menu.locator('[data-testid^="core-app-"][aria-current="page"]')).toHaveCount(0)
    await menu.getByTestId('core-app-tasks').click()
    await expect(page).toHaveURL(/\/my-tasks$/)
    await expect(menu.getByTestId('shell-org')).toBeVisible()
  })

  test('a badge shows the top-bar count of a tool and the accessible name carries it', async ({ page }) => {
    await open(page, '/apps')
    const menu = page.getByTestId('application-navigation')
    const barBadge = await page.getByTestId('tasks-tool').getAttribute('aria-label')
    const count = barBadge?.match(/\((\d+)\)/)?.[1]
    test.skip(!count, 'the mock has no open tasks for this user')
    await expect(menu.getByTestId('core-app-tasks').locator('[data-slot="badge"]')).toHaveText(count!)
    await expect(menu.getByTestId('core-app-tasks')).toHaveAccessibleName(`مهامي (${count})`)
  })

  test('the tiles fit the 264px column in a left-to-right interface too', async ({ page }) => {
    await open(page, '/apps')
    await page.evaluate(async () => { await (window as unknown as { useNuxtApp: () => { $i18n: { setLocale: (code: string) => Promise<void> } } }).useNuxtApp().$i18n.setLocale('en') })
    const row = page.getByTestId('application-navigation').getByTestId('core-apps')
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
    const tops = await row.locator('a').evaluateAll(links => links.map(link => Math.round(link.getBoundingClientRect().top)))
    expect(new Set(tops).size).toBe(1)
    expect((await row.boundingBox())!.x + (await row.boundingBox())!.width).toBeLessThanOrEqual(264)
    expect(await fitsWidth(page)).toBe(true)
  })

  test('from 768px to 1099px the row stands upright at the top of the icon strip', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 })
    await open(page, '/apps')
    const menu = page.getByTestId('application-navigation')
    expect((await menu.boundingBox())!.width).toBe(84)
    const lefts = await menu.getByTestId('core-apps').locator('a').evaluateAll(links => links.map(link => Math.round(link.getBoundingClientRect().left)))
    const tops = await menu.getByTestId('core-apps').locator('a').evaluateAll(links => links.map(link => Math.round(link.getBoundingClientRect().top)))
    expect(new Set(lefts).size).toBe(1)
    expect(tops).toEqual([...tops].sort((a, b) => a - b))
    expect(new Set(tops).size).toBe(CORE.length)
    // The brand mark stays above the strip and the pinned application rows follow it.
    expect((await menu.locator('.liwan-side-brand').boundingBox())!.y).toBeLessThan(tops[0]!)
    expect((await menu.getByTestId('navigation-app-projects').boundingBox())!.y).toBeGreaterThan(tops.at(-1)!)
    await menu.getByTestId('core-app-ai').hover()
    await expect(page.locator('[role="tooltip"]').filter({ hasText: 'Liwan AI' })).toBeVisible()
    expect(await fitsWidth(page)).toBe(true)
  })

  test('the row is not drawn in the sidebar on a phone; the drawer has the same row with 44px targets', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page, '/apps')
    await expect(page.getByTestId('application-navigation')).toBeHidden()
    await page.getByTestId('mobile-navigation-trigger').click()
    const drawer = page.locator('#mobile-navigation')
    await expect(drawer.getByTestId('mobile-core-apps')).toBeVisible()
    await expect(drawer.getByTestId('mobile-core-apps').locator('a')).toHaveCount(CORE.length)
    for (const link of await drawer.getByTestId('mobile-core-apps').locator('a').all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await drawer.getByTestId('mobile-core-app-meetings').click()
    await expect(page).toHaveURL(/\/meetings$/)
    await expect(drawer).toBeHidden()
  })
})

test.describe('sidebar footer', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeEach(async ({ page }) => { await login(page) })

  test('«كل التطبيقات» and the settings close the sidebar once each, below the lists, in both modes', async ({ page }) => {
    for (const path of ['/apps', '/crm']) {
      await open(page, path)
      const menu = page.getByTestId('application-navigation')
      const footer = menu.locator('.liwan-side-footer')
      await expect(footer.getByTestId('navigation-app-apps')).toHaveAttribute('href', '/apps')
      await expect(footer.getByTestId('navigation-app-settings')).toHaveAttribute('href', /^\/settings/)
      await expect(menu.getByTestId('navigation-app-apps')).toHaveCount(1)
      await expect(footer.getByRole('link')).toHaveCount(2)
      await expect(menu.getByTestId('account-menu')).toHaveCount(0)
      const apps = (await footer.getByTestId('navigation-app-apps').boundingBox())!
      const last = (await menu.locator('.liwan-side-body a').last().boundingBox())!
      expect(apps.y).toBeGreaterThan(last.y)
    }
  })

  test('the settings row enters the settings application menu', async ({ page }) => {
    await open(page, '/apps')
    const menu = page.getByTestId('application-navigation')
    await menu.getByTestId('navigation-app-settings').click()
    await expect(page).toHaveURL(/\/settings/)
    await expect(menu).toHaveAttribute('data-mode', 'app')
    await expect(menu.getByTestId('navigation-app-block')).toBeVisible()
    await expect(menu.getByTestId('navigation-app-settings')).toHaveAttribute('data-active', 'true')
  })

  test('in the 84px strip the footer rows keep their names and show them in a tooltip', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 })
    await open(page, '/apps')
    const menu = page.getByTestId('application-navigation')
    await expect(menu.getByTestId('navigation-app-apps')).toHaveAccessibleName('كل التطبيقات')
    await expect(menu.getByTestId('navigation-app-settings')).toHaveAccessibleName('الإعدادات')
    await menu.getByTestId('navigation-app-settings').hover()
    await expect(page.locator('[role="tooltip"]').filter({ hasText: 'الإعدادات' })).toBeVisible()
    expect(await fitsWidth(page)).toBe(true)
  })
})
