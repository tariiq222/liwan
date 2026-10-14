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

test.describe('Plan 6b: the department record', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('is the record template: one h1, the documents section, the properties aside', async ({ page }) => {
      await open(page, '/hr/departments/2')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('الموارد البشرية')
      await expect(page.locator('[data-template="record"]')).toHaveCount(1)
      const headings = await page.locator('main h2').allTextContents()
      expect(headings.map(text => text.trim())).toEqual(['مستندات القسم', 'نظرة عامة'])
      const aside = page.getByRole('complementary', { name: 'الخصائص' })
      await expect(aside.locator('[data-slot="property-row"]')).toHaveCount(2)
      await expect(aside.getByText('خالد الشمري')).toBeVisible()
      await expect(page.getByRole('link', { name: 'تعديل القسم' })).toHaveAttribute('href', /\/hr\/departments\/2\/edit/)
    })

    test('the embedded document list is the page\'s only data table and opens a document', async ({ page }) => {
      await open(page, '/hr/departments/2')
      await expect(page.locator('[data-slot="data-table"]')).toHaveCount(1)
      await expect(rows(page)).toHaveCount(2)
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/hr\/departments\/2\/documents\/2\?/)
    })

    test('the back link returns to the list the department was opened from', async ({ page }) => {
      await open(page, '/hr/departments?view=tree&q=الموارد')
      await page.getByRole('button', { name: /^الموارد البشرية/ }).first().click()
      await expect(page).toHaveURL(/\/hr\/departments\/2\?/)
      await page.getByRole('link', { name: 'رجوع', exact: true }).click()
      await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('tree')
      expect(new URL(page.url()).searchParams.get('q')).toBe('الموارد')
    })

    test('the new-document panel keeps the department behind it without a second heading', async ({ page }) => {
      await open(page, '/hr/departments/2/documents/new')
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.getByRole('dialog').getByRole('heading', { name: 'مستند جديد' })).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.locator('[data-template="record"]')).toHaveCount(1)
    })

    test('a department without a manager says so; a department without documents shows the empty state', async ({ page }) => {
      await open(page, '/hr/departments/3')
      await expect(page.getByRole('complementary', { name: 'الخصائص' }).getByText('لا يوجد مدير')).toBeVisible()
      await expect(page.getByRole('status').filter({ hasText: 'لا مستندات' })).toBeVisible()
    })

    test('a reader without hr.documents.read sees no documents section', async ({ page }) => {
      let restrictedResponses = 0
      await page.route('**/api/v1/me', async (route) => {
        const response = await route.fetch()
        const body = await response.json()
        body.capabilities = body.capabilities.filter((c: string) => !c.startsWith('hr.documents.') && !c.endsWith('.manage'))
        restrictedResponses += 1
        await route.fulfill({ response, json: body })
      })
      // Direct SSR cannot be intercepted by a browser route. Client navigation refreshes /me.
      await open(page, '/hr/departments')
      await page.evaluate(() => (window as any).useNuxtApp().$router.push('/hr/departments/2'))
      await expect.poll(() => restrictedResponses).toBeGreaterThan(0)
      await expect(page.getByRole('heading', { level: 2, name: 'مستندات القسم' })).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'تعديل القسم' })).toHaveCount(0)
      await expect(page.getByRole('heading', { level: 2, name: 'نظرة عامة' })).toBeVisible()
    })

    test('an unknown department shows the not-found state and no actions', async ({ page }) => {
      test.slow()
      for (const id of ['999', '0', 'abc', '-1', '1.5', '9007199254740992']) {
        await open(page, `/hr/departments/${id}`)
        await expect(page.locator('[data-slot="not-found-state"]'), id).toBeVisible()
        await expect(page.getByRole('link', { name: 'تعديل القسم' }), id).toHaveCount(0)
        await expect(page.getByRole('complementary', { name: 'الخصائص' }), id).toHaveCount(0)
      }
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('on a 390px phone the aside follows the sections and the page fits', async ({ page }) => {
      await open(page, '/hr/departments/2')
      expect(await fitsWidth(page)).toBe(true)
      const sectionTop = await page.getByRole('heading', { level: 2, name: 'مستندات القسم' }).evaluate(node => node.getBoundingClientRect().top)
      const asideTop = await page.getByRole('complementary', { name: 'الخصائص' }).evaluate(node => node.getBoundingClientRect().top)
      expect(asideTop).toBeGreaterThan(sectionTop)
      await expect(mobileRows(page)).toHaveCount(2)
    })
  })
})
