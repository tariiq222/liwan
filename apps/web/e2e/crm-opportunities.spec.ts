import { test, expect, type Page } from '@playwright/test'
import { CrmCallListSchema, CrmCallResultSchema, CrmOpportunityListSchema, CrmOpportunitySchema } from '@webvue/contracts'
import { MOCK_STACK_ONLY } from './support/mock-pages'

// Runs against the isolated synthetic stack (MODULE_UI_PREVIEW=1): the CRM mock keeps state, reset before each test.
test.skip(process.env.E2E_PROJECT_POPUPS !== '1', MOCK_STACK_ONLY)

async function login(page: Page) {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.beforeEach(async ({ page }) => {
  await login(page)
  const reset = await page.request.post('/api/v1/__mock/reset-crm', { data: {} })
  expect(reset.ok()).toBe(true)
})

test('list, due filter, no-answer call, then a sale', async ({ page }) => {
  await page.goto('/crm/opportunities')
  await expect(page.locator('main h1')).toHaveText('فرص')
  await expect(page.getByRole('link', { name: 'أحمد العتيبي' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'سارة القحطاني' })).toBeVisible()

  await page.getByTestId('crm-filter-due').click()
  await expect(page).toHaveURL(/due=1/)
  await expect(page.getByRole('link', { name: 'سارة القحطاني' })).toHaveCount(0)
  await page.getByRole('link', { name: 'أحمد العتيبي' }).click()

  await expect(page.locator('main h1')).toHaveText('أحمد العتيبي')
  await expect(page.getByTestId('crm-phone')).toHaveAttribute('href', 'tel:0501234567')
  await page.getByTestId('crm-call-form').getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'لا يرد' }).click()
  await page.getByTestId('crm-call-submit').click()
  await expect(page.getByTestId('crm-recorded')).toContainText('الاتصال القادم')
  await expect(page.getByTestId('crm-next-call')).toBeVisible()
  await expect(page.getByTestId('crm-call-log')).toContainText('لا يرد')

  await page.getByTestId('crm-call-form').getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'تم البيع' }).click()
  await page.getByTestId('crm-sale-form').getByRole('combobox').click()
  await page.getByRole('option', { name: /باقة متقدمة/ }).click()
  await expect(page.getByTestId('crm-sale-discount')).toHaveValue('0%')
  await page.getByTestId('crm-call-submit').click()
  await expect(page.locator('main h1').locator('..')).toContainText('تم البيع')
  await expect(page.getByTestId('crm-call-form')).toHaveCount(0)
})

test('the board lists the four stages and the stage filter survives back navigation', async ({ page }) => {
  await page.goto('/crm/opportunities?view=board')
  for (const id of [1, 2, 3, 4]) await expect(page.getByTestId(`crm-board-column-${id}`)).toBeVisible()
  await expect(page.getByTestId('crm-board-column-1')).toContainText('أحمد العتيبي')

  await page.goto('/crm/opportunities?stage_id=3')
  await expect(page.getByRole('link', { name: 'محمد الدوسري' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'أحمد العتيبي' })).toHaveCount(0)
  await page.getByRole('link', { name: 'محمد الدوسري' }).click()
  await expect(page.locator('main h1')).toHaveText('محمد الدوسري')
  await page.goBack()
  await expect(page).toHaveURL(/stage_id=3/)
  await expect(page.getByRole('link', { name: 'محمد الدوسري' })).toBeVisible()
})

test('lost closes inline after a confirmation and a manager reopens it', async ({ page }) => {
  await page.goto('/crm/opportunities/3')
  await page.getByTestId('crm-open-lost').click()
  await expect(page.getByTestId('inline-confirm')).toBeVisible()
  await page.getByRole('combobox', { name: /سبب الخسارة/ }).click()
  await page.getByRole('option', { name: 'غير مهتم' }).click()
  await page.getByTestId('inline-confirm-action').click()
  await expect(page.getByTestId('crm-reopen')).toBeVisible()
  await page.getByTestId('crm-reopen').click()
  await expect(page.getByTestId('crm-reopen')).toHaveCount(0)
  await expect(page.getByTestId('crm-call-form')).toBeVisible()
})

test('create panel adds an opportunity and a duplicate phone is refused', async ({ page }) => {
  await page.goto('/crm/opportunities/new')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.locator('#contact-name').fill('منى الجهني')
  await page.locator('#contact-phone').fill('0501234567')
  await page.getByTestId('crm-opportunity-save').click()
  await expect(page.getByRole('dialog')).toContainText('مسجل لدى سجل آخر')
  await page.locator('#contact-phone').fill('0577000111')
  await page.getByTestId('crm-opportunity-save').click()
  await expect(page).toHaveURL(/\/crm\/opportunities\/9/)
  await expect(page.locator('main h1')).toHaveText('منى الجهني')
})

test('the stage select leaves out the sold stage and the mock refuses it like the server', async ({ page }) => {
  await page.goto('/crm/opportunities/3')
  await page.getByTestId('crm-stage-select').click()
  await expect(page.getByRole('option')).toHaveText(['جديد', 'تم التواصل', 'مهتم'])
  await page.keyboard.press('Escape')
  const refused = await page.request.patch('/api/v1/crm/opportunities/3', { data: { stage_id: 4 } })
  expect(refused.status()).toBe(422)
  expect(await refused.json()).toMatchObject({ field: 'stage_id' })
})

test('a conflict refreshes the page to the closed record', async ({ page }) => {
  await page.goto('/crm/opportunities/3')
  await expect(page.getByTestId('crm-call-form')).toBeVisible()
  // Another user closes it while this page is open.
  expect((await page.request.post('/api/v1/crm/opportunities/3/lost', { data: { lost_reason_id: 1 } })).ok()).toBe(true)
  await page.getByTestId('crm-call-form').getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'لا يرد' }).click()
  await page.getByTestId('crm-call-submit').click()
  await expect(page.getByTestId('crm-call-form')).toHaveCount(0)
  await expect(page.getByTestId('crm-reopen')).toBeVisible()
  await expect(page.getByTestId('crm-failure')).toContainText('تغيّر هذا السجل أو أُغلق')
})

test('a losing outcome without a reason sends the reason with the call, which is logged', async ({ page }) => {
  await page.goto('/crm/opportunities/3')
  await page.getByTestId('crm-call-form').getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'رقم خاطئ' }).click()
  await page.getByRole('combobox', { name: /سبب الخسارة/ }).click()
  await page.getByRole('option', { name: 'غير مهتم' }).click()
  await page.getByTestId('crm-call-submit').click()
  await expect(page.getByTestId('crm-reopen')).toBeVisible()
  await expect(page.getByTestId('crm-call-log')).toContainText('رقم خاطئ')
})

test('an unknown or malformed record id shows the not-found state, not a skeleton', async ({ page }) => {
  for (const path of ['/crm/opportunities/999', '/crm/opportunities/abc']) {
    await page.goto(path)
    await expect(page.locator('[data-slot="not-found-state"]'), path).toBeVisible()
  }
})

test('the mock answers in the contract shapes and refuses like the server', async ({ page }) => {
  const api = page.request
  const list = CrmOpportunityListSchema.parse(await (await api.get('/api/v1/crm/opportunities')).json())
  expect(list.total).toBe(7)
  expect(CrmOpportunitySchema.parse(await (await api.get('/api/v1/crm/opportunities/6')).json()).status).toBe('lost')
  expect(CrmCallListSchema.parse(await (await api.get('/api/v1/crm/opportunities/1/calls')).json()).total).toBe(1)

  const followed = await api.post('/api/v1/crm/opportunities/3/calls', { data: { outcome_id: 1 } })
  expect(CrmCallResultSchema.parse(await followed.json()).opportunity.next_call_at).not.toBeNull()
  expect((await api.post('/api/v1/crm/opportunities/3/won', { data: { package_id: 1, final_price: 60 } })).status()).toBe(403)
  const mismatch = await api.post('/api/v1/crm/opportunities/3/won', { data: { package_id: 1, final_price: 108, discount_percent: 5 } })
  expect(await mismatch.json()).toMatchObject({ field: 'discount_percent' })
  const sold = await api.post('/api/v1/crm/opportunities/3/calls', { data: { outcome_id: 3, package_id: 1, final_price: 108 } })
  expect(CrmCallResultSchema.parse(await sold.json()).opportunity).toMatchObject({ status: 'won', discount_percent: 10 })
  expect((await api.post('/api/v1/crm/opportunities/3/calls', { data: { outcome_id: 1 } })).status()).toBe(409)
})
