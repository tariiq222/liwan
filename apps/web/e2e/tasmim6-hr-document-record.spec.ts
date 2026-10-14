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

test.describe('Plan 6b: the document record', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('is the record template: the document name as the only h1, its department, one body section', async ({ page }) => {
      await open(page, '/hr/departments/1/documents/1')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('دليل إجراءات التشغيل')
      await expect(page.locator('[data-template="record"]')).toHaveCount(1)
      await expect(page.locator('[data-slot="page-header"]')).toContainText('إدارة العمليات')
      const headings = await page.locator('main h2').allTextContents()
      expect(headings.map(text => text.trim())).toEqual(['المحتوى'])
      await expect(page.getByText('يوضح هذا المستند إجراءات التشغيل المعتمدة للفريق.')).toBeVisible()
      await expect(page.getByRole('link', { name: 'تعديل', exact: true })).toHaveAttribute('href', /\/hr\/departments\/1\/documents\/1\/edit/)
    })

    test('attachments are listed only when the document has any', async ({ page }) => {
      await open(page, '/hr/departments/1/documents/1')
      await expect(page.getByRole('heading', { level: 3, name: 'المرفقات' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'دليل التشغيل.pdf' })).toBeVisible()
      await open(page, '/hr/departments/2/documents/2')
      await expect(page.getByRole('heading', { level: 3, name: 'المرفقات' })).toHaveCount(0)
    })

    test('the back link returns to the list the document was opened from', async ({ page }) => {
      await open(page, '/hr/documents?department_id=2')
      await rows(page).first().getByRole('link').first().click()
      await expect(page).toHaveURL(/\/hr\/departments\/2\/documents\/2\?/)
      await page.getByRole('link', { name: 'رجوع', exact: true }).click()
      await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe('/hr/documents?department_id=2')
    })

    test('a reader sees the document but no edit link', async ({ page }) => {
      await asReader(page)
      await open(page, '/hr/departments/1/documents/1')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('دليل إجراءات التشغيل')
      await expect(page.getByRole('link', { name: 'تعديل', exact: true })).toHaveCount(0)
    })

    test('an unknown document shows the not-found state and no actions', async ({ page }) => {
      test.slow()
      for (const id of ['999', '0', 'abc', '-1', '1.5', '9007199254740992']) {
        await open(page, `/hr/departments/1/documents/${id}`)
        await expect(page.locator('[data-slot="not-found-state"]'), id).toBeVisible()
        await expect(page.getByRole('link', { name: 'تعديل', exact: true }), id).toHaveCount(0)
      }
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('on a 390px phone the document fits the width', async ({ page }) => {
      await open(page, '/hr/departments/1/documents/1')
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
