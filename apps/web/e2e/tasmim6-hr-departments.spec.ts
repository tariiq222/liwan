import { expect, test, type Page } from '@playwright/test'

// Plan 6b: /hr/departments on SharedListPage + SharedDataTable. Runs on the isolated mock stack
// (Nuxt + mock API, see p5-e2e.sh); the session comes from the login API. The mock lists three departments.
const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
async function login(page: Page) {
  const response = await page.request.post('/api/auth/login', { data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD } })
  expect(response.status()).toBe(200)
}
async function open(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled({ timeout: 60_000 })
}
// `mock_caps=reader` makes the mock /me drop every manage capability (e2e/mock-capabilities.mjs).
async function asReader(page: Page) {
  await page.context().addCookies([{ name: 'mock_caps', value: 'reader', url: process.env.E2E_BASE_URL ?? 'http://localhost:4322' }])
}
const rows = (page: Page) => page.locator('tbody tr[data-shortcut-row]')
const mobileRows = (page: Page) => page.locator('li[data-shortcut-row]')
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test.describe('Plan 6b: the departments list', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('is the list template: one heading, the page create button, a data table, the three-view switch', async ({ page }) => {
      await open(page, '/hr/departments')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('الهيكل التنظيمي')
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await expect(page.locator('[data-slot="data-table"]')).toBeVisible()
      await expect(rows(page)).toHaveCount(3)
      const create = page.getByTestId('hr-department-new')
      await expect(create).toHaveAttribute('data-shortcut-create', '')
      await expect(create).toHaveAttribute('href', /\/hr\/departments\/new/)
      for (const id of ['list', 'tree', 'canvas']) await expect(page.getByTestId(`hr-departments-view-${id}`)).toBeVisible()
      await expect(page.getByTestId('hr-departments-view-list')).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByTestId('hr-department-table')).toBeVisible()
    })

    test('an unknown or repeated ?view= opens the list view and the switch agrees', async ({ page }) => {
      for (const path of ['/hr/departments?view=gantt', '/hr/departments?view=table', '/hr/departments?view=list']) {
        await open(page, path)
        await expect(rows(page)).toHaveCount(3)
        await expect(page.getByTestId('hr-departments-view-list')).toHaveAttribute('aria-pressed', 'true')
      }
      await open(page, '/hr/departments?view=tree&view=canvas')
      await expect(page.getByTestId('hr-department-tree')).toBeVisible()
      await expect(page.getByTestId('hr-departments-view-tree')).toHaveAttribute('aria-pressed', 'true')
    })

    test('the switch keeps the search, drops view for the list, and each view draws its own surface', async ({ page }) => {
      await open(page, '/hr/departments?q=الموارد')
      await expect(rows(page)).toHaveCount(1)
      await page.getByTestId('hr-departments-view-tree').click()
      await expect(page.getByTestId('hr-department-tree')).toBeVisible()
      expect(new URL(page.url()).searchParams.get('view')).toBe('tree')
      expect(new URL(page.url()).searchParams.get('q')).toBe('الموارد')
      await page.getByTestId('hr-departments-view-canvas').click()
      await expect(page.getByTestId('hr-department-org-chart')).toBeVisible()
      await page.getByTestId('hr-departments-view-list').click()
      await expect(rows(page)).toHaveCount(1)
      expect(new URL(page.url()).searchParams.has('view')).toBe(false)
      expect(new URL(page.url()).searchParams.get('q')).toBe('الموارد')
    })

    test('the org chart fits the viewport and keeps its controls', async ({ page }) => {
      await open(page, '/hr/departments?view=canvas')
      const chart = page.getByTestId('hr-department-org-chart')
      await expect(chart).toBeVisible()
      await expect(page.getByTestId('hr-org-zoom-in')).toBeEnabled()
      await expect(page.getByTestId('hr-org-fullscreen')).toBeEnabled()
      // The list card is sticky and fills the screen once the page header has scrolled away (DESIGN.md, fill cards).
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      await expect.poll(() => chart.evaluate(node => node.getBoundingClientRect().bottom)).toBeLessThanOrEqual(900 + 1)
    })

    test('a department opened from each view returns to that view with its filters', async ({ page }) => {
      for (const view of ['tree', 'list']) {
        const url = view === 'list' ? '/hr/departments?q=الموارد' : `/hr/departments?view=${view}&q=الموارد`
        await open(page, url)
        if (view === 'tree') await page.getByRole('button', { name: /^الموارد البشرية/ }).first().click()
        else await rows(page).first().getByRole('link', { name: 'الموارد البشرية' }).click()
        await expect(page).toHaveURL(/\/hr\/departments\/2\?/)
        await page.getByRole('link', { name: 'رجوع', exact: true }).click()
        await expect.poll(() => new URL(page.url()).pathname).toBe('/hr/departments')
        await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe(view === 'list' ? null : view)
        expect(new URL(page.url()).searchParams.get('q')).toBe('الموارد')
      }
    })

    test('J and K move between rows, C and / reach create and search', async ({ page }) => {
      await open(page, '/hr/departments')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('j')
      await expect(rows(page).nth(1)).toBeFocused()
      await page.keyboard.press('/')
      await expect(page.locator('[data-shortcut-search] input')).toBeFocused()
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('c')
      await expect(page).toHaveURL(/\/hr\/departments\/new/)
      await expect(page.getByRole('dialog')).toBeVisible()
    })

    test('a department can be deleted only after the inline confirmation', async ({ page }) => {
      await open(page, '/hr/departments')
      await rows(page).nth(1).getByTestId('row-actions-menu').click()
      await page.getByRole('menuitem', { name: 'حذف' }).click()
      await expect(page.getByText('حذف الموارد البشرية؟')).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.getByRole('button', { name: 'إلغاء' }).click()
      await expect(page.getByText('حذف الموارد البشرية؟')).toHaveCount(0)
    })

    test('a reader sees no create button and no row actions', async ({ page }) => {
      await asReader(page)
      await open(page, '/hr/departments')
      await expect(rows(page)).toHaveCount(3)
      await expect(page.getByTestId('hr-department-new')).toHaveCount(0)
      await expect(page.getByTestId('row-actions-menu')).toHaveCount(0)
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('on a 390px phone the mobile rows carry the same information and J skips the hidden table', async ({ page }) => {
      await open(page, '/hr/departments')
      await expect(mobileRows(page)).toHaveCount(3)
      await expect(page.locator('table')).toBeHidden()
      const first = mobileRows(page).first()
      await expect(first).toContainText('إدارة العمليات')
      await expect(first).toContainText('سارة محمد')
      await expect(first.getByTestId('row-actions-menu')).toBeVisible()
      await expect(mobileRows(page).nth(2)).toContainText('لا يوجد مدير')
      expect(await fitsWidth(page)).toBe(true)
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(mobileRows(page).nth(0)).toBeFocused()
    })

    test('the tree and the org chart never widen the page', async ({ page }) => {
      for (const view of ['tree', 'canvas']) {
        await open(page, `/hr/departments?view=${view}`)
        expect(await fitsWidth(page), view).toBe(true)
      }
    })
  })
})
