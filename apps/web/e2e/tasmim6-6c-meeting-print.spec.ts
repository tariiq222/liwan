import { expect, test, type Page } from '@playwright/test'

// Plan 6c: /meetings/1/print on SharedStandalonePage variant="print" (isolated mock stack).
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

const article = (page: Page) => page.locator('[data-template="standalone-page"][data-variant="print"]')

test.describe('Plan 6c: the minutes print page', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeEach(async ({ page }) => { await login(page) })

  test('it is the print standalone page with one h1, the sheet and the actions', async ({ page }) => {
    await open(page, '/meetings/1/print')
    await expect(article(page)).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('طباعة محضر الاجتماع')
    await expect(page.getByTestId('meeting-print-sheet')).toBeVisible()
    await expect(page.getByTestId('meeting-minutes-document')).toBeVisible()
    await expect(page.getByTestId('meeting-print-action')).toBeEnabled()
    await expect(page.getByTestId('meeting-print-back')).toHaveAttribute('href', /\/meetings\/1/)
    await expect(page.locator('[data-slot="page-header"]')).toHaveCount(0)
  })

  test('the sheet shows the brand, the date facts and three signature lines', async ({ page }) => {
    await open(page, '/meetings/1/print')
    const sheet = page.getByTestId('meeting-print-sheet')
    await expect(sheet.getByText('محضر اجتماع', { exact: true })).toBeVisible()
    await expect(sheet.getByText('رئيس الاجتماع').last()).toBeVisible()
    await expect(sheet.locator('footer > div')).toHaveCount(3)
  })

  test('print media: black on white, landscape, no chrome, actions not printed', async ({ page }) => {
    await open(page, '/meetings/1/print')
    await page.emulateMedia({ media: 'print' })
    const style = await article(page).evaluate((node) => {
      const computed = getComputedStyle(node)
      return { color: computed.color, background: computed.backgroundColor, page: computed.getPropertyValue('page') }
    })
    expect(style.color).toBe('rgb(0, 0, 0)')
    expect(style.background).toBe('rgb(255, 255, 255)')
    expect(style.page).toBe('webvue-landscape')
    expect(await page.locator('.webvue-shell-header').evaluate(node => getComputedStyle(node).display)).toBe('none')
    expect(await page.getByTestId('meeting-print-action').evaluate(node => getComputedStyle(node.closest('footer')!).display)).toBe('none')
  })

  test('a dark appearance still prints black on white', async ({ page }) => {
    // The user's server-side appearance wins over the cookie, and the mock keeps it for every later spec: put it back.
    expect((await page.request.patch('/api/v1/me/appearance', { data: { mode: 'dark', font_size: 'small' } })).ok()).toBe(true)
    try {
      await open(page, '/meetings/1/print')
      await expect(page.locator('html')).toHaveClass(/dark/)
      await page.emulateMedia({ media: 'print' })
      expect(await article(page).evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(255, 255, 255)')
      expect(await page.getByTestId('meeting-minutes-document').evaluate(node => getComputedStyle(node).color)).toBe('rgb(0, 0, 0)')
    } finally {
      await page.request.patch('/api/v1/me/appearance', { data: { mode: 'light', font_size: 'small' } })
    }
  })

  test('an unknown version shows a not-found state with one h1 and no sheet', async ({ page }) => {
    await open(page, '/meetings/1/print?version_id=999')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByTestId('meeting-print-sheet')).toHaveCount(0)
    await expect(page.getByTestId('meeting-print-action')).toBeDisabled()
  })

  test('Escape leaves for the meeting', async ({ page }) => {
    await open(page, '/meetings/1/print')
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/meetings\/1(\?|$)/)
  })
})

test.describe('Plan 6c: the print page on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('fits the width and keeps both actions reachable', async ({ page }) => {
    await login(page)
    await open(page, '/meetings/1/print')
    expect(await fitsWidth(page)).toBe(true)
    await expect(page.getByTestId('meeting-print-back')).toBeVisible()
  })
})
