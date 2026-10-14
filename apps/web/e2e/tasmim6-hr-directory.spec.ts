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

test.describe('Plan 6b: the employee directory', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('is the list template: one heading, the page create button, a data table', async ({ page }) => {
      await open(page, '/hr')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('دليل الموظفين')
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await expect(page.locator('[data-slot="data-table"]')).toBeVisible()
      await expect(rows(page)).toHaveCount(3)
      const create = page.getByTestId('hr-employee-new')
      await expect(create).toBeVisible()
      await expect(create).toHaveAttribute('data-shortcut-create', '')
      await expect(create).toHaveAttribute('href', /\/hr\/employees\/new/)
      await expect(page.getByTestId('hr-directory-scope')).toBeVisible()
      await expect(page.getByTestId('hr-employee-name').first()).toHaveAttribute('href', /\/hr\/employees\/1\?.*returnTo=/)
      await expect(rows(page).first().getByTestId('hr-access-badge')).toBeVisible()
      await expect(rows(page).first().getByTestId('row-actions-menu')).toBeVisible()
    })

    test('a filtered archived list keeps its URL through a record and back', async ({ page }) => {
      await open(page, '/hr?q=ليلى&archived=1')
      await expect(rows(page)).toHaveCount(1)
      await rows(page).first().getByTestId('hr-employee-name').click()
      await expect(page).toHaveURL(/\/hr\/employees\/4\?/)
      await page.getByRole('link', { name: 'رجوع', exact: true }).click()
      await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe('/hr?q=ليلى&archived=1'.replace('ليلى', encodeURIComponent('ليلى')))
      await expect(rows(page)).toHaveCount(1)
    })

    test('the scope tabs and the department filter write the URL and keep each other', async ({ page }) => {
      await open(page, '/hr?department_id=2')
      await expect(rows(page)).toHaveCount(1)
      await page.getByTestId('hr-directory-scope').getByRole('tab', { name: 'المؤرشفون' }).click()
      await expect.poll(() => new URL(page.url()).searchParams.get('archived')).toBe('1')
      expect(new URL(page.url()).searchParams.get('department_id')).toBe('2')
      await page.getByTestId('hr-directory-scope').getByRole('tab', { name: 'النشطون' }).click()
      await expect.poll(() => new URL(page.url()).searchParams.has('archived')).toBe(false)
    })

    test('a filtered empty directory offers to clear the filters; an unfiltered one does not', async ({ page }) => {
      await open(page, '/hr?q=لا-يوجد')
      const empty = page.getByRole('status').filter({ hasText: 'لا موظفون يطابقون الفلاتر' })
      await expect(empty).toBeVisible()
      await empty.getByRole('button', { name: 'مسح الفلاتر' }).click()
      await expect(rows(page)).toHaveCount(3)
      await expect.poll(() => new URL(page.url()).searchParams.has('q')).toBe(false)
    })

    test('J and K move between rows and Enter opens the focused employee', async ({ page }) => {
      await open(page, '/hr')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('j')
      await expect(rows(page).nth(1)).toBeFocused()
      await page.keyboard.press('k')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/hr\/employees\/1(?:\?|$)/)
    })

    test('/ focuses the search and C presses the page create button', async ({ page }) => {
      await open(page, '/hr?q=خالد')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('/')
      await expect(page.locator('[data-shortcut-search] input')).toBeFocused()
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('c')
      await expect(page).toHaveURL(/\/hr\/employees\/new\?q=/)
      await expect(page.getByRole('dialog')).toBeVisible()
    })

    test('C inside the open create panel does not stack another, and Escape lands on the list it came from', async ({ page }) => {
      await open(page, '/hr/employees/new?q=%D8%AE%D8%A7%D9%84%D8%AF')
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await page.getByRole('dialog').getByRole('heading', { name: 'موظف جديد' }).click()
      await page.keyboard.press('c')
      await expect(page.getByRole('dialog')).toHaveCount(1)
      await page.keyboard.press('Escape')
      await expect.poll(() => new URL(page.url()).pathname).toBe('/hr')
      expect(new URL(page.url()).searchParams.get('q')).toBe('خالد')
    })

    test('the row actions menu opens manage and archive without opening the row', async ({ page }) => {
      await open(page, '/hr')
      await rows(page).first().getByTestId('row-actions-menu').click()
      await expect(page.getByRole('menuitem', { name: 'إدارة', exact: true })).toBeVisible()
      await page.getByRole('menuitem', { name: 'أرشفة الموظف' }).click()
      await expect(page.getByRole('button', { name: 'أرشفة الموظف' }).last()).toBeVisible()
      await expect(page).toHaveURL(/\/hr$/)
    })

    test('a reader sees no create button and no row actions', async ({ page }) => {
      await asReader(page)
      await open(page, '/hr')
      await expect(rows(page)).toHaveCount(3)
      await expect(page.getByTestId('hr-employee-new')).toHaveCount(0)
      await expect(page.getByTestId('row-actions-menu')).toHaveCount(0)
      await expect(page.getByTestId('hr-directory-scope')).toHaveCount(0)
    })

    test('a failing list shows the translated error with a working retry', async ({ page }) => {
      let fail = true
      await page.route('**/api/v1/hr/employees**', async (route) => {
        if (route.request().method() !== 'GET' || !fail) return route.continue()
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'unavailable', message: 'temporarily unavailable' }) })
      })
      // The first request of a direct visit is server-side (the browser route never sees it), so land
      // on another page and navigate to the directory on the client.
      await open(page, '/hr/departments')
      await page.evaluate(() => (window as any).useNuxtApp().$router.push('/hr'))
      const errorState = page.locator('[data-slot="error-state"]')
      await expect(errorState).toBeVisible({ timeout: 20_000 })
      await expect(errorState).toHaveAttribute('role', 'alert')
      await expect(errorState).toContainText('حدث خطأ غير متوقع')
      fail = false
      await errorState.getByRole('button', { name: 'إعادة المحاولة' }).click()
      await expect(errorState).toHaveCount(0)
      await expect(rows(page)).toHaveCount(3)
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('on a 390px phone the mobile rows carry the same information and J skips the hidden table', async ({ page }) => {
      await open(page, '/hr')
      await expect(mobileRows(page)).toHaveCount(3)
      await expect(page.locator('table')).toBeHidden()
      const first = mobileRows(page).first()
      await expect(first).toContainText('سارة محمد')
      await expect(first).toContainText('مديرة العمليات')
      await expect(first).toContainText('إدارة العمليات')
      await expect(first).toContainText('أحمد العتيبي')
      await expect(first.getByTestId('hr-access-badge')).toBeVisible()
      await expect(first.getByTestId('row-actions-menu')).toBeVisible()
      await expect(mobileRows(page).nth(2)).toContainText('—')
      expect(await fitsWidth(page)).toBe(true)
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(mobileRows(page).nth(0)).toBeFocused()
      await mobileRows(page).nth(0).click({ position: { x: 4, y: 4 } })
      await expect(page).toHaveURL(/\/hr\/employees\/1(?:\?|$)/)
    })
  })
})
