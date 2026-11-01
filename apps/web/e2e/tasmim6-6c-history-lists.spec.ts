import { expect, test, type Page } from '@playwright/test'

// Plan 6c: the meeting history and version lists on SharedRecordSection + SharedPageState (isolated mock stack).
// The mock serves meeting 1 with one event (minutes_saved by أحمد العتيبي) and one version.
const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
async function login(page: Page) {
  const response = await page.request.post('/api/auth/login', { data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD } })
  expect(response.status()).toBe(200)
}
async function open(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled({ timeout: 30_000 })
}
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

/** A client-side route change, so a request made after it can be intercepted (a full load is rendered on the server). */
// Relies on the dev-only window.useNuxtApp, so it runs only against `nuxt dev`.
async function clientNavigate(page: Page, path: string) {
  await page.evaluate(target => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } }).useNuxtApp().$router.push(target), path)
}

test.describe('Plan 6c: meeting history and version lists', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test('the history tab lists the events under one section heading', async ({ page }) => {
    await open(page, '/meetings/1?tab=history')
    const list = page.getByTestId('meeting-event-list')
    await expect(list).toBeVisible()
    await expect(list.getByRole('heading', { level: 2, name: 'النشاط' })).toBeVisible()
    await expect(list.locator('ol > li')).toHaveCount(1)
    await expect(list).toContainText('أحمد العتيبي')
    await expect(list.getByTestId('shared-pagination')).toHaveCount(0)
  })

  test('the versions tab lists the versions and shows the newest', async ({ page }) => {
    await open(page, '/meetings/1?tab=versions')
    const list = page.getByTestId('meeting-version-list')
    await expect(list.getByRole('heading', { level: 2, name: 'النسخ' })).toBeVisible()
    const version = list.locator('ol > li button')
    await expect(version).toHaveCount(1)
    await expect(page.getByTestId('meeting-minutes-document')).toBeVisible()
  })

  test('a failed history load shows the shared error and retries', async ({ page }) => {
    await open(page, '/meetings/1')
    await page.route('**/api/v1/meetings/1/events*', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'server_error', message: 'Synthetic failure' }) }))
    await clientNavigate(page, '/meetings/1?tab=history')
    const list = page.getByTestId('meeting-event-list')
    await expect(list.getByRole('button', { name: 'إعادة المحاولة' })).toBeVisible({ timeout: 20_000 })
    await expect(list.locator('ol')).toHaveCount(0)
    await page.unroute('**/api/v1/meetings/1/events*')
    await list.getByRole('button', { name: 'إعادة المحاولة' }).click()
    await expect(list.locator('ol > li')).toHaveCount(1)
    await expect(list.getByRole('button', { name: 'إعادة المحاولة' })).toHaveCount(0)
  })

  test('a history load that is still running shows the loading placeholder', async ({ page }) => {
    await open(page, '/meetings/1')
    await page.route('**/api/v1/meetings/1/events*', async route => { await new Promise(resolve => setTimeout(resolve, 1500)); await route.continue() })
    await clientNavigate(page, '/meetings/1?tab=history')
    await expect(page.getByTestId('meeting-event-list').locator('[data-slot="loading-skeleton"]')).toBeVisible()
    await expect(page.getByTestId('meeting-event-list').locator('ol > li')).toHaveCount(1, { timeout: 15_000 })
  })

  test('the lists fit a 390px phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page, '/meetings/1?tab=versions')
    await expect(page.getByTestId('meeting-version-list')).toBeVisible()
    expect(await fitsWidth(page)).toBe(true)
  })
})
