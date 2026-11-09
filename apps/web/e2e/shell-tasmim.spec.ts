import { expect, test, type Page } from '@playwright/test'

const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'

// Runs against the isolated mock stack (Nuxt 4097 + mock API 4498); the session comes from the login API.
async function login(page: Page) {
  const response = await page.request.post('/api/auth/login', { data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD } })
  expect(response.status()).toBe(200)
}

async function beforeHydration(page: Page, path: string) {
  let resume!: () => void
  const gate = new Promise<void>(resolve => { resume = resolve })
  await page.route('**/_nuxt/**', async route => {
    if (route.request().resourceType() === 'script') await gate
    await route.continue()
  })
  await page.goto(path, { waitUntil: 'commit' })
  return resume
}

test.describe('Tasmim sidebar', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeEach(async ({ page }) => { await login(page) })

  test('the sidebar is server-rendered at its full width before hydration and keeps it after', async ({ page }) => {
    const sidebar = page.getByTestId('application-navigation')
    const hydrate = await beforeHydration(page, '/tasks')
    await expect(sidebar).toBeVisible()
    expect((await sidebar.boundingBox())!.width).toBe(264)
    await expect(sidebar).toHaveAttribute('data-mode', 'app')
    hydrate()
    await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
    expect((await sidebar.boundingBox())!.width).toBe(264)
  })

  test('[ has no action: the sidebar neither folds nor stores a preference, also on an Arabic layout', async ({ page, context }) => {
    await page.goto('/tasks')
    const sidebar = page.getByTestId('application-navigation')
    await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
    const start = (await sidebar.boundingBox())!
    await page.keyboard.press('BracketLeft')
    // Arabic (101) layout: the same physical key types «ج».
    await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ج', code: 'BracketLeft', bubbles: true })))
    await page.waitForTimeout(300)
    expect(await sidebar.boundingBox()).toEqual(start)
    expect((await context.cookies()).find(cookie => cookie.name === 'liwan-context-sidebar')).toBeUndefined()
  })
})

test.describe('Tasmim top bar hydration', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeEach(async ({ page }) => { await login(page) })

  for (const path of ['/tasks', '/projects/1']) {
    test(`${path} hydrates without a mismatch, the header search goes live and the trail shows`, async ({ page }) => {
      const messages: string[] = []
      page.on('console', message => messages.push(message.text()))
      await page.goto(path)
      await expect(page.getByTestId('shell-header').getByTestId('global-search-trigger')).toBeEnabled()
      await expect(page.locator('main h1')).toHaveCount(1)
      // The trail sits under the page title and is published by the shell after hydration (the project frame has its own).
      if (path === '/tasks') await expect(page.getByTestId('page-header-trail')).toHaveText('المشاريع')
      expect(messages.filter(text => /hydration/i.test(text))).toEqual([])
    })
  }
})

test.describe('Tasmim mobile drawer', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test.beforeEach(async ({ page }) => { await login(page) })

  test('the «المزيد» tab waits for hydration, opens from the inline-start side and closes after navigation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const hydrate = await beforeHydration(page, '/tasks')
    const trigger = page.getByTestId('mobile-navigation-trigger')
    await expect(trigger).toBeVisible()
    await expect(trigger).toBeDisabled()
    hydrate()
    await expect(trigger).toBeEnabled()
    await trigger.click()
    const drawer = page.locator('#mobile-navigation')
    await expect(drawer).toBeVisible()
    const area = (await drawer.boundingBox())!
    expect(Math.abs(area.x + area.width - 390)).toBeLessThanOrEqual(1)
    // The drawer holds the sidebar content: on /tasks the open application, with a back row to all applications.
    await drawer.getByTestId('mobile-navigation-app-back').click()
    await expect(page).toHaveURL(/\/apps$/)
    await expect(drawer).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  })
})
