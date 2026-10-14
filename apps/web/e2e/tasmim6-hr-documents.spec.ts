import { expect, test, type Page } from '@playwright/test'

const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
async function login(page: Page) {
  const response = await page.request.post('/api/auth/login', { data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD } })
  expect(response.status()).toBe(200)
}
async function open(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled({ timeout: 45_000 })
}
async function asReader(page: Page) {
  // A read-only session: the mock drops every manage / archive / grant capability (T20).
  const origin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3000').origin
  await page.context().addCookies([{ name: 'mock_caps', value: 'reader', url: origin }])
}
const rows = (page: Page) => page.locator('tbody tr[data-shortcut-row]')
const mobileRows = (page: Page) => page.locator('li[data-shortcut-row]')
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test.describe('Plan 6b: the documents list', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('is the list template: one heading, the page create button, the toolbar, a data table', async ({ page }) => {
      await open(page, '/hr/documents')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('المستندات')
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await expect(page.getByTestId('documents-toolbar')).toBeVisible()
      await expect(rows(page)).toHaveCount(3)
      const create = page.getByTestId('hr-document-new')
      await expect(create).toHaveAttribute('data-shortcut-create', '')
      await expect(create).toHaveAttribute('href', /\/hr\/documents\/new/)
      await expect(rows(page).first().getByRole('link', { name: 'دليل إجراءات التشغيل' })).toHaveAttribute('href', /\/hr\/departments\/1\/documents\/1\?.*returnTo=/)
    })

    test('the department filter and the search write the URL and narrow the rows', async ({ page }) => {
      await open(page, '/hr/documents?department_id=2')
      await expect(rows(page)).toHaveCount(2)
      await page.getByPlaceholder('بحث بالعنوان…').fill('سياسة')
      await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('سياسة')
      expect(new URL(page.url()).searchParams.get('department_id')).toBe('2')
      await expect(rows(page)).toHaveCount(1)
    })

    test('a document opened from a filtered list returns to that list', async ({ page }) => {
      await open(page, '/hr/documents?department_id=2')
      await rows(page).first().getByRole('link').first().click()
      await expect(page).toHaveURL(/\/hr\/departments\/2\/documents\/2\?/)
      await page.getByRole('link', { name: 'رجوع', exact: true }).click()
      await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe('/hr/documents?department_id=2')
    })

    test('J and K move between rows, C opens the create panel over the list, Escape returns', async ({ page }) => {
      await open(page, '/hr/documents?department_id=2')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('Escape')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('c')
      await expect(page).toHaveURL(/\/hr\/documents\/new\?department_id=2/)
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await page.keyboard.press('Escape')
      await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe('/hr/documents?department_id=2')
    })

    test('a reader sees the list but no create button', async ({ page }) => {
      await asReader(page)
      await open(page, '/hr/documents')
      await expect(rows(page)).toHaveCount(3)
      await expect(page.getByTestId('hr-document-new')).toHaveCount(0)
    })

    test('an empty search shows the documents empty state', async ({ page }) => {
      await open(page, '/hr/documents?q=لا-يوجد')
      await expect(page.getByRole('status').filter({ hasText: 'لا مستندات' })).toBeVisible()
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('on a 390px phone the mobile rows carry the same information and J skips the hidden table', async ({ page }) => {
      await open(page, '/hr/documents')
      await expect(mobileRows(page)).toHaveCount(3)
      await expect(page.locator('table')).toBeHidden()
      await expect(mobileRows(page).first()).toContainText('دليل إجراءات التشغيل')
      await expect(mobileRows(page).first()).toContainText('إدارة العمليات')
      expect(await fitsWidth(page)).toBe(true)
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(mobileRows(page).nth(0)).toBeFocused()
    })
  })
})
