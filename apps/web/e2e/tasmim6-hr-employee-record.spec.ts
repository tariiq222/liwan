import { expect, test, type Page } from '@playwright/test'

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
async function asReader(page: Page) {
  // A read-only session: the mock drops every manage / archive / grant capability (T20).
  const origin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3000').origin
  await page.context().addCookies([{ name: 'mock_caps', value: 'reader', url: origin }])
}
const rows = (page: Page) => page.locator('tbody tr[data-shortcut-row]')
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test.describe('Plan 6b: the employee record', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('is the record template: one h1 with the job line, two sections, the properties aside', async ({ page }) => {
      await open(page, '/hr/employees/1')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('سارة محمد')
      await expect(page.locator('[data-template="record"]')).toHaveCount(1)
      await expect(page.locator('[data-slot="page-header"]')).toContainText('مديرة العمليات')
      const headings = await page.locator('main h2').allTextContents()
      expect(headings.map(text => text.trim())).toEqual(['نظرة عامة', 'الحساب'])
      const aside = page.getByRole('complementary', { name: 'الخصائص' })
      await expect(aside.locator('[data-slot="property-row"]')).toHaveCount(5)
      await expect(aside.getByText('sara@example.test')).toBeVisible()
      await expect(aside.getByText('أحمد العتيبي')).toBeVisible()
      await expect(page.getByTestId('hr-access-badge')).toBeVisible()
      await expect(page.getByRole('img', { name: 'سارة محمد' })).toBeVisible()
    })

    test('the actions are edit, manage account and archive, and archive confirms inline', async ({ page }) => {
      await open(page, '/hr/employees/1')
      await expect(page.getByRole('link', { name: 'تعديل', exact: true })).toHaveAttribute('href', /\/hr\/employees\/1\/edit/)
      await expect(page.getByRole('link', { name: 'إدارة الحساب' })).toHaveAttribute('href', /\/settings\/team\/users\/1/)
      await page.getByRole('button', { name: 'أرشفة الموظف' }).click()
      await expect(page.getByText('هل تريد تغيير حالة نشاط هذا الموظف؟')).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.getByRole('button', { name: 'إلغاء' }).click()
      await expect(page.getByText('هل تريد تغيير حالة نشاط هذا الموظف؟')).toHaveCount(0)
    })

    test('an employee without facts shows dashes with a spoken «لا قيمة»', async ({ page }) => {
      await open(page, '/hr/employees/3')
      const aside = page.getByRole('complementary', { name: 'الخصائص' })
      await expect(aside.locator('[data-slot="property-row"]')).toHaveCount(5)
      await expect(aside.getByText('لا قيمة')).toHaveCount(5)
      await expect(page.getByTestId('hr-access-badge')).toContainText('بدون حساب')
    })

    test('the back link returns to the filtered directory the employee was opened from', async ({ page }) => {
      await open(page, '/hr?q=خالد&department_id=2')
      await rows(page).first().getByTestId('hr-employee-name').click()
      await expect(page).toHaveURL(/\/hr\/employees\/2\?/)
      await page.getByRole('link', { name: 'رجوع', exact: true }).click()
      await expect.poll(() => new URL(page.url()).searchParams.get('department_id')).toBe('2')
      expect(new URL(page.url()).searchParams.get('q')).toBe('خالد')
    })

    test('a reader sees the facts but no edit, archive or account link, and the account block follows its capability', async ({ page }) => {
      await asReader(page)
      await open(page, '/hr/employees/1')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('سارة محمد')
      await expect(page.getByRole('link', { name: 'تعديل', exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'أرشفة الموظف' })).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'إدارة الحساب' })).toBeVisible()
    })

    test('an unknown id shows the not-found state with no actions; a non-numeric id does not crash', async ({ page }) => {
      await open(page, '/hr/employees/999')
      await expect(page.locator('[data-slot="not-found-state"]')).toBeVisible()
      await expect(page.getByRole('button', { name: 'أرشفة الموظف' })).toHaveCount(0)
      for (const invalidId of ['abc', '0', '-1', '1.5', '9007199254740992']) {
        await open(page, `/hr/employees/${invalidId}`)
        await expect(page.locator('[data-slot="not-found-state"]'), invalidId).toBeVisible()
        await expect(page.getByRole('heading', { level: 1 }), invalidId).toHaveText('الموظف')
        await expect(page.getByRole('link', { name: 'تعديل', exact: true }), invalidId).toHaveCount(0)
        await expect(page.getByRole('link', { name: 'إدارة الحساب' }), invalidId).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'أرشفة الموظف' }), invalidId).toHaveCount(0)
        await expect(page.getByRole('complementary', { name: 'الخصائص' }), invalidId).toHaveCount(0)
      }
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('on a 390px phone the properties follow the sections and the page fits', async ({ page }) => {
      await open(page, '/hr/employees/1')
      expect(await fitsWidth(page)).toBe(true)
      const sectionTop = await page.getByRole('heading', { level: 2, name: 'نظرة عامة' }).evaluate(node => node.getBoundingClientRect().top)
      const asideTop = await page.getByRole('complementary', { name: 'الخصائص' }).evaluate(node => node.getBoundingClientRect().top)
      expect(asideTop).toBeGreaterThan(sectionTop)
    })
  })
})
