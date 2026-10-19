import { expect, test, type Page } from '@playwright/test'

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
async function asReader(page: Page) {
  // A read-only session: the mock drops every manage / archive / grant capability (T20).
  const origin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3000').origin
  await page.context().addCookies([{ name: 'mock_caps', value: 'reader', url: origin }])
}
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test.describe('Plan 6b: the HR forms', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    for (const [name, path, heading] of [
      ['employee', '/hr/employees/new?q=خالد', 'موظف جديد'],
      ['department', '/hr/departments/new?parent_id=1', 'قسم جديد'],
      ['document', '/documents/new?context_kind=hr.department&context_id=2', 'مستند جديد'],
    ] as const) {
      test(`the ${name} create route is a panel over its list, with one heading and a way back`, async ({ page }) => {
        await open(page, path)
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        await expect(dialog.getByRole('heading', { name: heading })).toBeVisible()
        // The owning ListPage stays mounted behind the route-backed create panel.
        await expect(page.locator('[data-template="list"]')).toHaveCount(1)
        await dialog.getByRole('button', { name: 'إلغاء' }).or(dialog.getByRole('link', { name: 'إلغاء' })).click()
        await expect(page.getByRole('dialog')).toHaveCount(0)
      })
    }

    test('the department create panel preselects the parent from the link', async ({ page }) => {
      await open(page, '/hr/departments/new?parent_id=1')
      await expect(page.getByRole('combobox', { name: 'القسم الأب', exact: true })).toContainText('إدارة العمليات')
    })

    test('the employee edit page is a form page: back link, two panel sections, footer actions', async ({ page }) => {
      await open(page, '/hr/employees/1/edit')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('تعديل الموظف')
      const headings = await page.locator('main h2').allTextContents()
      expect(headings.map(text => text.trim())).toEqual(['عام', 'التبعية التنظيمية'])
      // Each section is its own panel: two card headers, no card around them.
      await expect(page.locator('main [data-slot="header"]')).toHaveCount(2)
      await expect(page.locator('#hr-employee-name')).toHaveValue('سارة محمد')
      await expect(page.getByRole('button', { name: 'حفظ' })).toBeEnabled()
      const { width, rootFontSize } = await page.locator('[data-layout-width="form"]').evaluate(node => ({
        width: node.getBoundingClientRect().width,
        rootFontSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      }))
      // The approved width is 58rem at each supported root size (14/16/18px).
      expect(width / rootFontSize).toBeLessThanOrEqual(58 + 1 / rootFontSize)
      await expect(page.getByRole('link', { name: 'رجوع', exact: true })).toHaveAttribute('href', /\/hr\/employees\/1/)
    })

    test('the department edit page is a form page with the department in it', async ({ page }) => {
      await open(page, '/hr/departments/2/edit')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('تعديل القسم')
      await expect(page.locator('#hr-dept-name')).toHaveValue('الموارد البشرية')
      await expect(page.locator('main [data-slot="header"]')).toHaveCount(1)
      await expect(page.getByRole('link', { name: 'رجوع', exact: true })).toHaveAttribute('href', /\/hr\/departments\/2/)
    })

    test('the document edit page keeps its labels, ids and file field in two panel sections', async ({ page }) => {
      await open(page, '/documents/1/edit')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('تعديل المستند')
      await expect(page.locator('#hr-doc-title')).toHaveValue('دليل إجراءات التشغيل')
      await expect(page.getByLabel('رفع ملف')).toBeVisible()
      await expect(page.getByRole('link', { name: 'دليل التشغيل.pdf' })).toBeVisible()
      const headings = await page.locator('main h2').allTextContents()
      expect(headings.map(text => text.trim())).toEqual(['تعديل المستند', 'المرفقات'])
      await expect(page.locator('main [data-slot="header"]')).toHaveCount(2)
      await expect(page.getByRole('button', { name: 'حفظ', exact: true })).toBeEnabled()
    })

    test('typing in an edit form then leaving asks before dropping the draft', async ({ page }) => {
      await open(page, '/hr/employees/1/edit')
      await page.locator('#hr-employee-name').fill('اسم معدل')
      await page.getByRole('link', { name: 'رجوع', exact: true }).click()
      const guard = page.getByTestId('unsaved-changes-dialog')
      await expect(guard).toBeVisible()
      await expect(guard.getByRole('heading', { name: 'تغييرات غير محفوظة' })).toBeVisible()
      await guard.getByRole('button', { name: 'البقاء في الصفحة' }).click()
      await expect(guard).toHaveCount(0)
      await expect(page).toHaveURL(/\/hr\/employees\/1\/edit/)
      await expect(page.locator('#hr-employee-name')).toHaveValue('اسم معدل')
    })

    test('a reader gets the forbidden state on every edit page and no form', async ({ page }) => {
      test.slow()
      await asReader(page)
      for (const path of ['/hr/employees/1/edit', '/hr/departments/2/edit', '/documents/1/edit']) {
        const response = await page.goto(path)
        expect(response?.status(), path).toBe(403)
        // The route capability gate answers a reader with the app's 403 page; the in-page state is the fallback.
        await expect(page.getByText('ليس لديك صلاحية لعرض هذه الصفحة').or(page.getByRole('heading', { name: 'تعذّر عرض الصفحة' })).first(), path).toBeVisible({ timeout: 30_000 })
        await expect(page.getByTestId('app-error').getByText('403', { exact: true }), path).toBeVisible()
        await expect(page.getByRole('button', { name: 'حفظ' }), path).toHaveCount(0)
      }
    })

    test('an unknown record on an edit page shows the not-found state', async ({ page }) => {
      await open(page, '/hr/employees/999/edit')
      await expect(page.locator('[data-slot="not-found-state"]')).toBeVisible()
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('on a 390px phone the edit forms and the create panel fit the width', async ({ page }) => {
      for (const path of ['/hr/employees/1/edit', '/hr/departments/2/edit', '/documents/1/edit']) {
        await open(page, path)
        expect(await fitsWidth(page), path).toBe(true)
      }
      await open(page, '/hr/employees/new')
      await expect(page.getByRole('dialog')).toBeVisible()
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
