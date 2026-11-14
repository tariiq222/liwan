import { test, expect, type Page } from '@playwright/test'

// Runs against the isolated synthetic stack (MODULE_UI_PREVIEW=1): sales-mock-routes.mjs keeps state, reset before each
// test. Seed: S00001 draft (mine, a section, a product and a note), S00002 confirmed (another salesperson), S00003
// cancelled, S00004 an online order, confirmed and locked. `mock_caps=reader` drops every write capability and
// `mock_sales=branch` reads the settings with `can_manage: false`.
test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'the sales checks run on the isolated mock stack (npm run e2e:mock)')

async function login(page: Page) {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function useCookie(page: Page, name: string, value: string) {
  await page.context().addCookies([{ name, value, url: new URL(page.url()).origin }])
}

const numbers = (page: Page) => page.getByTestId('sales-order-link')
const panel = (page: Page) => page.getByRole('dialog')
const heading = (page: Page) => page.locator('main h1')

test.beforeEach(async ({ page }) => {
  await login(page)
  const reset = await page.request.post('/api/v1/__mock/reset-sales', { data: {} })
  expect(reset.ok()).toBe(true)
})

test('the list keeps its filters in the address and Back from a record returns to the same filtered list', async ({ page }) => {
  await page.goto('/sales')
  await expect(numbers(page)).toHaveText(['S00001', 'S00002', 'S00003', 'S00004'])

  await page.getByTestId('sales-search').fill('النخيل')
  await expect(page).toHaveURL(/q=/)
  await page.getByTestId('sales-stage').getByText('عروض الأسعار', { exact: true }).click()
  await expect(page).toHaveURL(/state=quotations/)
  await page.getByTestId('sales-source').click()
  await page.getByRole('option', { name: 'فريق المبيعات' }).click()
  await expect(page).toHaveURL(/source=staff/)
  await page.getByTestId('sales-mine').click()
  await expect(page).toHaveURL(/mine=1/)
  await expect(numbers(page)).toHaveText(['S00001'])
  const filtered = page.url()

  await numbers(page).first().click()
  await expect(page).toHaveURL(/\/sales\/1(\?|$)/)
  await expect(heading(page)).toHaveText('S00001')
  await page.goBack()
  await expect(page).toHaveURL(filtered)
  await expect(numbers(page)).toHaveText(['S00001'])
  await expect(page.getByTestId('sales-search')).toHaveValue('النخيل')

  await numbers(page).first().click()
  await expect(heading(page)).toHaveText('S00001')
  await page.getByRole('link', { name: 'رجوع' }).first().click()
  await expect(page).toHaveURL(/\/sales\?/)
  for (const part of [/q=/, /state=quotations/, /source=staff/, /mine=1/]) await expect(page).toHaveURL(part)
  await expect(numbers(page)).toHaveText(['S00001'])
})

test('a direct link to /sales/new opens the create panel over the list, and Escape or close return to the list', async ({ page }) => {
  await page.goto('/sales/new')
  await expect(panel(page)).toBeVisible()
  await expect(panel(page).getByText('عرض سعر جديد').first()).toBeVisible()
  await expect(numbers(page).first()).toBeAttached()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/sales$/)
  await expect(panel(page)).toHaveCount(0)

  await page.goto('/sales/new?returnTo=/sales?state=orders')
  await expect(panel(page)).toBeVisible()
  await panel(page).getByRole('button', { name: 'إغلاق' }).first().click()
  await expect(page).toHaveURL(/\/sales\?state=orders$/)
  await expect(numbers(page)).toHaveText(['S00002', 'S00004'])
})

test('an unsaved create form asks before leaving, and a created quotation is not reopened by Back', async ({ page }) => {
  await page.goto('/sales?state=orders')
  await page.getByTestId('sales-new').click()
  await expect(page).toHaveURL(/\/sales\/new/)
  await panel(page).getByTestId('sales-terms').fill('شروط لم تحفظ')
  await page.goBack()
  await expect(page.getByText('تغييرات غير محفوظة').first()).toBeVisible()
  await page.getByRole('button', { name: 'المغادرة بدون حفظ' }).click()
  await expect(page).toHaveURL(/\/sales\?state=orders$/)
  await expect(panel(page)).toHaveCount(0)

  await page.getByTestId('sales-new').click()
  await expect(panel(page)).toBeVisible()
  await panel(page).getByText('مؤسسة النخيل').first().click()
  await panel(page).getByTestId('sales-line-0').getByTestId('product-picker-search').click()
  await panel(page).getByTestId('sales-line-0').getByText('باقة أساسية').first().click()
  await panel(page).getByTestId('sales-submit').click()
  await expect(page).toHaveURL(/\/sales\/100/)
  await expect(heading(page)).toHaveText('S00100')
  await page.goBack()
  await expect(page).not.toHaveURL(/\/sales\/new/)
  await expect(page).toHaveURL(/\/sales\?state=orders$/)
  await expect(panel(page)).toHaveCount(0)
})

test('a quotation is created with a customer, a product line, a section and a note, and the record shows them', async ({ page }) => {
  await page.goto('/sales/new')
  const form = panel(page)
  await form.getByText('مؤسسة النخيل').first().click()
  await form.getByTestId('sales-line-0').getByTestId('product-picker-search').click()
  await form.getByTestId('sales-line-0').getByText('باقة أساسية').first().click()
  await form.getByTestId('sales-line-quantity-0').fill('3')
  await form.getByTestId('sales-line-add-section').click()
  await form.getByTestId('sales-line-name-1').fill('قسم الخدمات')
  await form.getByTestId('sales-line-add-note').click()
  await form.getByTestId('sales-line-name-2').fill('التسليم خلال أسبوع')
  await form.getByTestId('sales-submit').click()

  await expect(page).toHaveURL(/\/sales\/100/)
  await expect(heading(page)).toHaveText('S00100')
  await expect(page.getByTestId('sales-customer')).toContainText('مؤسسة النخيل')
  const lines = page.getByTestId('sales-lines-panel')
  await expect(lines).toContainText('باقة أساسية')
  await expect(lines).toContainText('قسم الخدمات')
  await expect(lines).toContainText('التسليم خلال أسبوع')
})

test('the record buttons follow the order actions, and the moves, the cancel confirmation and duplicate work', async ({ page }) => {
  const shown = (testId: string) => page.getByTestId(testId)

  await page.goto('/sales/4')
  await expect(heading(page)).toHaveText('S00004')
  await expect(shown('sales-online')).toBeVisible()
  // Read-only: no write or move; copying it into a new staff quotation is the one action the server keeps.
  for (const id of ['sales-edit', 'sales-confirm', 'sales-cancel', 'sales-lock', 'sales-unlock', 'sales-reopen', 'sales-assign-open']) {
    await expect(shown(id), id).toHaveCount(0)
  }
  await expect(shown('sales-duplicate')).toBeVisible()

  await page.goto('/sales/3')
  await expect(heading(page)).toHaveText('S00003')
  await expect(shown('sales-reopen')).toBeVisible()
  for (const id of ['sales-edit', 'sales-confirm', 'sales-cancel', 'sales-lock']) await expect(shown(id), id).toHaveCount(0)

  await page.goto('/sales/2')
  await expect(heading(page)).toHaveText('S00002')
  await expect(shown('sales-lock')).toBeVisible()
  await expect(shown('sales-cancel')).toBeVisible()
  for (const id of ['sales-edit', 'sales-confirm', 'sales-unlock', 'sales-reopen']) await expect(shown(id), id).toHaveCount(0)

  await page.goto('/sales/1')
  await expect(heading(page)).toHaveText('S00001')
  for (const id of ['sales-edit', 'sales-confirm', 'sales-cancel', 'sales-duplicate']) await expect(shown(id), id).toBeVisible()
  for (const id of ['sales-lock', 'sales-unlock', 'sales-reopen']) await expect(shown(id), id).toHaveCount(0)

  await shown('sales-confirm').click()
  await expect(page.locator('main').getByText('مؤكَّد').first()).toBeVisible()
  await expect(shown('sales-edit')).toHaveCount(0)
  await shown('sales-lock').click()
  await expect(shown('sales-unlock')).toBeVisible()
  await expect(shown('sales-cancel')).toHaveCount(0)
  await shown('sales-unlock').click()
  await expect(shown('sales-lock')).toBeVisible()

  await shown('sales-cancel').click()
  await expect(page.getByText('هل تريد إلغاء S00001؟')).toBeVisible()
  await expect(page.getByRole('button', { name: 'إلغاء المستند' })).toBeVisible()
  await page.getByRole('button', { name: 'تراجع' }).click()
  await expect(page.getByText('هل تريد إلغاء S00001؟')).toHaveCount(0)
  await shown('sales-cancel').click()
  await page.getByRole('button', { name: 'إلغاء المستند' }).click()
  await expect(shown('sales-reopen')).toBeVisible()
  await expect(page.locator('main').getByText('ملغى').first()).toBeVisible()

  await shown('sales-reopen').click()
  await expect(shown('sales-edit')).toBeVisible()
  await expect(page.locator('main').getByText('مسودة').first()).toBeVisible()

  await shown('sales-duplicate').click()
  await expect(page).toHaveURL(/\/sales\/100/)
  await expect(heading(page)).toHaveText('S00100')
  await expect(page.getByTestId('sales-lines-panel')).toContainText('باقة أساسية')
})

test('editing a draft returns to the record with the change, and a confirmed order cannot be edited', async ({ page }) => {
  await page.goto('/sales/1')
  await page.getByTestId('sales-edit').click()
  await expect(page).toHaveURL(/\/sales\/1\/edit/)
  await expect(heading(page)).toHaveText('تعديل عرض السعر')
  await page.getByTestId('sales-terms').fill('شروط معدّلة')
  await page.getByTestId('sales-submit').click()
  await expect(page).toHaveURL(/\/sales\/1(\?|$)/)
  await expect(heading(page)).toHaveText('S00001')
  await expect(page.getByTestId('sales-terms')).toHaveText('شروط معدّلة')

  await page.goto('/sales/2/edit')
  await expect(page.getByText('لا يمكن تعديل هذا المستند الآن.', { exact: false })).toBeVisible()
  await expect(page.getByTestId('sales-submit')).toHaveCount(0)
})

test('a reader sees no create or edit and is refused /sales/new', async ({ page }) => {
  await useCookie(page, 'mock_caps', 'reader')
  await page.goto('/sales')
  await expect(numbers(page).first()).toBeVisible()
  await expect(page.getByTestId('sales-new')).toHaveCount(0)

  await page.goto('/sales/1')
  await expect(heading(page)).toHaveText('S00001')
  for (const id of ['sales-edit', 'sales-confirm', 'sales-cancel', 'sales-duplicate']) await expect(page.getByTestId(id), id).toHaveCount(0)

  await page.goto('/sales/new')
  await expect(page.locator('main h1')).toHaveText('لا تملك صلاحية فتح هذه الصفحة')
  await expect(page.getByTestId('sales-submit')).toHaveCount(0)
  await expect(page.getByTestId('sales-lines')).toHaveCount(0)
})

test('the settings page is read-only without can_manage and saves for a manager', async ({ page }) => {
  await useCookie(page, 'mock_sales', 'branch')
  await page.goto('/settings/apps/sales')
  await expect(page.getByTestId('sales-settings-readonly')).toBeVisible()
  await expect(page.getByTestId('sales-validity-days')).toBeDisabled()

  await page.context().clearCookies({ name: 'mock_sales' })
  await page.goto('/settings/apps/sales')
  await expect(page.getByTestId('sales-settings-readonly')).toHaveCount(0)
  const days = page.getByTestId('sales-validity-days')
  await expect(days).toHaveValue('30')
  await days.fill('45')
  await days.blur()
  await page.getByRole('button', { name: /^حفظ/ }).first().click()
  await expect.poll(async () => (await (await page.request.get('/api/v1/sales/settings')).json()).validity_days).toBe(45)
  await page.reload()
  await expect(page.getByTestId('sales-validity-days')).toHaveValue('45')
})
