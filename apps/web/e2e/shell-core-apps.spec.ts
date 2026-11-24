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
  { id: 'tasks', route: /\/work$/, name: 'أعمالي' },
  { id: 'meetings', route: /\/meetings$/, name: 'الاجتماعات' },
  { id: 'chat', route: /\/chat$/, name: 'المحادثات' },
] as const

test.describe('core apps icon row', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeEach(async ({ page }) => { await login(page) })

  test('lists the five core applications in order under the organisation, each named by its label', async ({ page }) => {
    await open(page, '/apps')
    const menu = page.getByTestId('application-navigation')
    const row = menu.getByTestId('core-apps')
    await expect(row).toBeVisible()
    await expect(row.locator('a')).toHaveCount(CORE.length)
    const ids = await row.locator('a').evaluateAll(links => links.map(link => link.getAttribute('data-testid')))
    expect(ids).toEqual(CORE.map(item => `core-app-${item.id}`))
    for (const item of CORE) await expect(row.getByTestId(`core-app-${item.id}`)).toHaveAccessibleName(new RegExp(`^${item.name}`))
    // The row sits under the organisation card, and no tile wraps: all five share one line.
    const org = (await menu.getByTestId('shell-org').boundingBox())!
    const tops = await row.locator('a').evaluateAll(links => links.map(link => Math.round(link.getBoundingClientRect().top)))
    expect(new Set(tops).size).toBe(1)
    expect(tops[0]!).toBeGreaterThan(org.y + org.height)
    const box = (await row.boundingBox())!
    expect(box.width).toBeLessThanOrEqual(264)
  })

  test('the list «تطبيقاتي» no longer carries the day, the assistant, the free applications, the documents or the operations', async ({ page }) => {
    await open(page, '/apps')
    const menu = page.getByTestId('application-navigation')
    const lists = menu.locator('.liwan-side-body')
    for (const id of ['home', 'ai', 'tasks', 'meetings', 'chat', 'documents', 'operations']) await expect(lists.getByTestId(`navigation-app-${id}`)).toHaveCount(0)
    await expect(lists.getByTestId('navigation-app-projects')).toBeVisible()
    // The all-applications page offers no pin for a free application.
    for (const card of await page.getByTestId('launcher-row').all()) {
      const app = await card.getAttribute('data-app')
      if (['ai', 'tasks', 'meetings', 'chat', 'documents', 'operations'].includes(app!)) await expect(card.getByTestId('launcher-pin')).toHaveCount(0)
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

  test('documents: a click on its footer icon opens its own full page, not the slide-over, and lights the icon', async ({ page }) => {
    await open(page, '/apps')
    const menu = page.getByTestId('application-navigation')
    await expect(menu.getByTestId('core-app-documents')).toHaveCount(0)
    await menu.locator('.liwan-side-footer').getByTestId('footer-tool-documents').click()
    await expect(page).toHaveURL(/\/documents$/)
    await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
    await expect(menu.getByTestId('footer-tool-documents')).toHaveAttribute('data-active', 'true')
    await expect(menu.locator('[data-testid^="core-app-"][aria-current="page"]')).toHaveCount(0)
    await expect(page.locator('[data-testid^="slide-over-"]:visible')).toHaveCount(0)
  })

  test('the bar carries no application tool buttons: those pages open from the core row', async ({ page }) => {
    await open(page, '/projects')
    // The panels left the bar with the 2026-11-21 shell decision (DESIGN.md §3); the core row is the single way in.
    for (const gone of ['chat-tool', 'tasks-tool', 'meetings-tool']) await expect(page.getByTestId(gone)).toHaveCount(0)
    await page.getByTestId('application-navigation').getByTestId('core-app-meetings').click()
    await expect(page).toHaveURL(/\/meetings$/)
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
    const blockBox = (await menu.getByTestId('navigation-app-block').boundingBox())!
    // The order is organisation card, core row, application block: the back row that used to sit between them left the
    // top of the sidebar (the footer carries «كل التطبيقات»).
    expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(blockBox.y)
    await expect(menu.getByTestId('navigation-app-back')).toHaveCount(0)
    // No tile is lit on an application that is not a core one.
    await expect(menu.locator('[data-testid^="core-app-"][aria-current="page"]')).toHaveCount(0)
    await menu.getByTestId('core-app-tasks').click()
    await expect(page).toHaveURL(/\/work$/)
    await expect(menu.getByTestId('shell-org')).toBeVisible()
  })

  test('the tile badge carries the count in its visible number and its accessible name', async ({ page }) => {
    await open(page, '/apps')
    const menu = page.getByTestId('application-navigation')
    const tile = menu.getByTestId('core-app-tasks')
    const label = await tile.getAttribute('aria-label')
    const count = label?.match(/\((\d+)\)/)?.[1]
    test.skip(!count, 'the mock has no open tasks for this user')
    await expect(tile.locator('[data-slot="badge"]')).toHaveText(count!)
    await expect(tile).toHaveAccessibleName(`أعمالي (${count})`)
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

  test('the footer is one row of icon buttons in a fixed order, below the lists, in both modes', async ({ page }) => {
    for (const path of ['/apps', '/crm']) {
      await open(page, path)
      const menu = page.getByTestId('application-navigation')
      const footer = menu.locator('.liwan-side-footer')
      await expect(footer.getByTestId('footer-tool-apps')).toHaveAttribute('href', '/apps')
      await expect(footer.getByTestId('footer-tool-settings')).toHaveAttribute('href', /^\/settings/)
      // The named list is closed: no named row exists until the chevron opens it.
      await expect(menu.getByTestId('navigation-app-apps')).toHaveCount(0)
      // The base applications come first (operations only with its capability), then «كل التطبيقات», the settings, the support button and the chevron.
      const ids = await footer.getByTestId('footer-tools').locator('a, button').evaluateAll(items => items.map(item => item.getAttribute('data-testid')))
      expect(ids).toEqual([
        'footer-tool-documents',
        ...ids.filter(id => id === 'footer-tool-operations'),
        'footer-tool-apps',
        'footer-tool-settings',
        'footer-tool-support',
        'footer-toggle',
      ])
      await expect(menu.getByTestId('account-menu')).toHaveCount(0)
      const apps = (await footer.getByTestId('footer-tool-apps').boundingBox())!
      const last = (await menu.locator('.liwan-side-body a').last().boundingBox())!
      expect(apps.y).toBeGreaterThan(last.y)
      const boxes = await footer.getByTestId('footer-tools').locator('a, button').evaluateAll(items => items.map(item => Math.round(item.getBoundingClientRect().top)))
      expect(new Set(boxes).size).toBe(1)
    }
  })

  test('the support icon is an aria-disabled button, focusable for its tooltip, with no link and no action yet', async ({ page }) => {
    await open(page, '/apps')
    const menu = page.getByTestId('application-navigation')
    const support = menu.getByTestId('footer-tool-support')
    await expect(support).toHaveAccessibleName('الدعم الفني (قريبًا)')
    await expect(support).toHaveAttribute('aria-disabled', 'true')
    await expect(support).not.toHaveAttribute('disabled', /.*/)
    await expect(support).not.toHaveAttribute('href', /.+/)
    await expect(menu.getByTestId('footer-tools')).toHaveAccessibleName('اختصارات عامة')
    await support.focus()
    await expect(support).toBeFocused()
    await expect(page.locator('[role="tooltip"]').filter({ hasText: 'الدعم الفني (قريبًا)' })).toBeVisible()
    const url = page.url()
    // Playwright treats aria-disabled as not actionable, so the click is forced: it must still do nothing.
    await support.click({ force: true })
    expect(page.url()).toBe(url)
    await expect(menu.getByTestId('footer-list')).toHaveCount(0)
  })

  test('the chevron opens the named list above the row and a second click closes it', async ({ page }) => {
    await open(page, '/settings')
    const menu = page.getByTestId('application-navigation')
    const toggle = menu.getByTestId('footer-toggle')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(menu.getByTestId('footer-list')).toHaveCount(0)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(menu.getByTestId('footer-list').getByRole('link').first()).toBeFocused()
    const list = menu.getByTestId('footer-list')
    await expect(list.getByTestId('navigation-app-apps')).toHaveText('كل التطبيقات')
    await expect(list.getByTestId('navigation-app-settings')).toHaveAttribute('data-active', 'true')
    await expect(menu.getByTestId('footer-tool-settings')).toHaveAttribute('data-active', 'true')
    expect((await list.boundingBox())!.y + (await list.boundingBox())!.height).toBeLessThanOrEqual((await menu.getByTestId('footer-tools').boundingBox())!.y)
    await list.getByTestId('navigation-app-apps').click()
    await expect(page).toHaveURL(/\/apps$/)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(menu.getByTestId('footer-list')).toHaveCount(0)
  })

  test('the settings icon enters the settings application menu', async ({ page }) => {
    await open(page, '/apps')
    const menu = page.getByTestId('application-navigation')
    await menu.getByTestId('footer-tool-settings').click()
    await expect(page).toHaveURL(/\/settings/)
    await expect(menu).toHaveAttribute('data-mode', 'app')
    await expect(menu.getByTestId('navigation-app-block')).toBeVisible()
    await expect(menu.getByTestId('footer-tool-settings')).toHaveAttribute('data-active', 'true')
  })

  test('in the 84px strip the footer icons keep their names, show them in a tooltip and drop the chevron', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 })
    await open(page, '/apps')
    const menu = page.getByTestId('application-navigation')
    await expect(menu.getByTestId('footer-tool-apps')).toHaveAccessibleName('كل التطبيقات')
    await expect(menu.getByTestId('footer-tool-settings')).toHaveAccessibleName('الإعدادات')
    await expect(menu.getByTestId('footer-toggle')).toBeHidden()
    await menu.getByTestId('footer-tool-settings').hover()
    await expect(page.locator('[role="tooltip"]').filter({ hasText: 'الإعدادات' })).toBeVisible()
    expect(await fitsWidth(page)).toBe(true)
  })
})
