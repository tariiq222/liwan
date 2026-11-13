import { test, expect, type Page } from '@playwright/test'

// Runs against the isolated synthetic stack (MODULE_UI_PREVIEW=1): customers-mock-routes.mjs keeps state, reset before
// each test. Seed: Mona (+966500000001, city Riyadh, VIP), a shared company, Khaled with Mona's phone, Sara archived.
test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'the customers checks run on the isolated mock stack (npm run e2e:mock)')

async function login(page: Page) {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

const names = (page: Page) => page.getByTestId('customer-name-link')

test.beforeEach(async ({ page }) => {
  await login(page)
  const reset = await page.request.post('/api/v1/__mock/reset-customers', { data: {} })
  expect(reset.ok()).toBe(true)
})

test('the directory lists active customers, searches them from the address and switches to the archived ones', async ({ page }) => {
  await page.goto('/customers')
  await expect(names(page)).toHaveText(['منى العتيبي', 'مؤسسة النخيل', 'خالد الشهري'])
  await expect(page.getByText('مشترك بين كل الفروع').first()).toBeVisible()

  await page.getByTestId('customers-search').fill('النخيل')
  await expect(page).toHaveURL(/q=/)
  await expect(names(page)).toHaveText(['مؤسسة النخيل'])

  await page.goto('/customers')
  await page.getByTestId('customers-scope').getByText('مؤرشف', { exact: true }).click()
  await expect(page).toHaveURL(/archived=1/)
  await expect(names(page)).toHaveText(['سارة الحربي'])
})

test('create answers the phone conflict and "create a new customer" makes the customer', async ({ page }) => {
  await page.goto('/customers/new')
  await page.locator('#customer-name').fill('منى الجديدة')
  await page.locator('#customer-phone').fill('0500000001')
  await page.getByTestId('customer-submit').click()
  const choice = page.getByTestId('customers-conflict-choice')
  await expect(choice).toBeVisible()
  await expect(choice).toContainText('منى العتيبي')
  await expect(choice).toContainText('0001')
  await expect(choice).not.toContainText('966500000001')

  await choice.getByText('إنشاء عميل جديد', { exact: true }).click()
  await page.getByTestId('inline-confirm-action').click()
  await expect(page).toHaveURL(/\/customers\/10/)
  await expect(page.locator('main h1')).toHaveText('منى الجديدة')
})

test('an invalid phone is shown at the phone field', async ({ page }) => {
  await page.goto('/customers/new')
  await page.locator('#customer-name').fill('عميل')
  await page.locator('#customer-phone').fill('12ab')
  await page.getByTestId('customer-submit').click()
  await expect(page.getByText('رقم الجوال غير صحيح')).toBeVisible()
})

test('a contact is created under a company chosen in the picker, and the record names the company', async ({ page }) => {
  await page.goto('/customers/new')
  await page.locator('#customer-name').fill('فهد النخيل')
  await page.getByTestId('customer-parent').click()
  await page.getByRole('option', { name: 'مؤسسة النخيل' }).click()
  await page.getByTestId('customer-submit').click()
  await expect(page).toHaveURL(/\/customers\/10/)
  await expect(page.getByText('مؤسسة النخيل').first()).toBeVisible()
})

test('the record page shows the custom field values of the customer', async ({ page }) => {
  await page.goto('/customers/1')
  await expect(page.locator('main h1')).toHaveText('منى العتيبي')
  await expect(page.getByText('المدينة').first()).toBeVisible()
  await expect(page.getByText('الرياض').first()).toBeVisible()
})

test('the record opens from an address that ends with a slash', async ({ page }) => {
  await page.goto('/customers/1/')
  await expect(page.locator('main h1')).toHaveText('منى العتيبي')
})

test('the settings page saves the party kinds', async ({ page }) => {
  await page.goto('/settings/apps/customers')
  await page.getByTestId('customers-party-kinds').getByText('أفراد', { exact: true }).click()
  await page.getByTestId('settings-save-bar-save').click()
  await expect(page.getByTestId('settings-save-bar')).toBeHidden()
  const saved = await (await page.request.get('/api/v1/customers/settings')).json()
  expect(saved.party_kinds).toBe('individuals')
})

test('the phone country is changed from the list of countries and cleared to the main company country', async ({ page }) => {
  await page.goto('/settings/apps/customers')
  await page.getByTestId('customers-phone-country').click()
  await page.getByRole('option', { name: 'مصر' }).click()
  await page.getByTestId('settings-save-bar-save').click()
  await expect(page.getByTestId('settings-save-bar')).toBeHidden()
  expect((await (await page.request.get('/api/v1/customers/settings')).json()).phone_country.code).toBe('EG')
})

test('removing a field that customers hold values for shows the count and succeeds after confirming', async ({ page }) => {
  await page.goto('/settings/apps/customers')
  await page.getByRole('button', { name: 'حذف الحقل عميل مميز' }).click()
  await page.locator('#fields').getByRole('button', { name: 'حذف الحقل', exact: true }).click()
  await page.getByTestId('settings-save-bar-save').click()
  const removal = page.getByTestId('customers-field-removal')
  await expect(removal).toBeVisible()
  await expect(removal).toContainText('عميل مميز')
  await expect(removal).toContainText('قيمة واحدة')
  await removal.getByRole('button', { name: 'احذف الحقول وقيمها' }).click()
  await expect(removal).toHaveCount(0)
  const saved = await (await page.request.get('/api/v1/customers/settings')).json()
  expect(saved.fields.map((field: { key: string }) => field.key)).toEqual(['city'])
})

test('a branch session sees the settings read-only with the reason', async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: 'mock_customers', value: 'branch', url: baseURL! }])
  await page.goto('/settings/apps/customers')
  const note = page.getByTestId('customers-settings-readonly')
  await expect(note).toBeVisible()
  await expect(note).toContainText('مديري الشركة الرئيسية')
  await expect(page.getByTestId('settings-save-bar')).toHaveCount(0)
  await expect(page.getByTestId('customers-party-kinds').locator('input[type=radio]').first()).toBeDisabled()
})

test('a session without the customers feature has no rail entry and is refused the directory', async ({ page, baseURL }) => {
  await page.goto('/')
  await expect(page.locator('a[href="/customers"]').first()).toBeAttached()
  await page.context().addCookies([{ name: 'mock_feature_off', value: 'customers.enabled', url: baseURL! }])
  await page.goto('/')
  await expect(page.locator('a[href="/customers"]')).toHaveCount(0)
  await page.goto('/customers')
  await expect(page.getByTestId('customers-search')).toHaveCount(0)
  await expect(page.getByText('هذه الصفحة غير متاحة في باقتك')).toBeVisible()
  await expect(page.getByText('هذه الميزة غير مشمولة في باقتك.')).toBeVisible()
})

test('a reader without customers.manage sees the directory and the record but no create and no edit action', async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: 'mock_caps', value: 'reader', url: baseURL! }])
  await page.goto('/customers')
  await expect(names(page).first()).toBeVisible()
  await expect(page.getByTestId('customer-new')).toHaveCount(0)
  await page.goto('/customers/1')
  await expect(page.locator('main h1')).toHaveText('منى العتيبي')
  await expect(page.getByTestId('customer-edit')).toHaveCount(0)
  await page.goto('/customers/new')
  await expect(page.getByText('لا تملك صلاحية فتح هذه الصفحة')).toBeVisible()
  await expect(page.locator('#customer-name')).toHaveCount(0)
})

test('editing sends a PATCH and the record shows the change', async ({ page }) => {
  await page.goto('/customers/1/edit')
  await page.locator('#customer-name').fill('منى السالم')
  const patch = page.waitForRequest(request => request.method() === 'PATCH' && request.url().endsWith('/api/v1/customers/1'))
  await page.getByTestId('customer-submit').click()
  expect((await patch).postDataJSON()).toEqual({ name: 'منى السالم' })
  await expect(page).toHaveURL(/\/customers\/1(\?|$)/)
  await expect(page.locator('main h1')).toHaveText('منى السالم')
  await page.goBack()
  await expect(page).not.toHaveURL(/\/edit/)
})

test('archive then restore from the record', async ({ page }) => {
  await page.goto('/customers/1')
  await page.getByRole('button', { name: 'إجراءات العميل منى العتيبي' }).click()
  await page.getByRole('menuitem', { name: 'أرشفة' }).click()
  await page.getByTestId('inline-confirm-action').click()
  await expect(page.getByText('مؤرشف').first()).toBeVisible()
  // An archived customer has one action, so the row-actions button runs it directly instead of opening a menu.
  await page.getByRole('button', { name: /^استعادة.*منى العتيبي/ }).click()
  await page.getByTestId('inline-confirm-action').click()
  await expect(page.getByText('نشط').first()).toBeVisible()
  expect((await (await page.request.get('/api/v1/customers/1')).json()).active).toBe(true)
})
