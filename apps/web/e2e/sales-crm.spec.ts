import { test, expect, type Page } from '@playwright/test'
import { CrmOpportunitySchema, SalesOrderSchema } from '@liwan/contracts'
import { MOCK_STACK_ONLY } from './support/mock-pages'

// Runs against the isolated synthetic stack (MODULE_UI_PREVIEW=1): the CRM bridge to Sales. The CRM and Sales mocks keep
// state, reset before each test. `POST /api/v1/__mock/crm-win-by-order {on: true}` switches the bridge on: an order wins its
// opportunity, the package form steps aside, and opportunity 2 (سارة القحطاني) is linked to the customer «مؤسسة النخيل».
// Opportunity 1 has no customer and opportunity 6 is lost.
test.skip(process.env.E2E_PROJECT_POPUPS !== '1', MOCK_STACK_ONLY)

async function login(page: Page) {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function bridge(page: Page, on: boolean, canQuote = true) {
  const answer = await page.request.post('/api/v1/__mock/crm-win-by-order', { data: { on, can_quote: canQuote } })
  expect(answer.ok()).toBe(true)
}

const opportunity = async (page: Page, id: number) => CrmOpportunitySchema.parse(await (await page.request.get(`/api/v1/crm/opportunities/${id}`)).json())

test.beforeEach(async ({ page }) => {
  await login(page)
  for (const reset of ['/api/v1/__mock/reset-crm', '/api/v1/public/sales/__mock/reset']) expect((await page.request.post(reset, { data: {} })).ok()).toBe(true)
})

test('without the bridge the opportunity is won with a package and shows no quotations', async ({ page }) => {
  await page.goto('/crm/opportunities/2')
  await expect(page.getByTestId('crm-open-sale')).toBeVisible()
  await expect(page.getByTestId('crm-open-quotation')).toHaveCount(0)
  await expect(page.getByTestId('crm-orders')).toHaveCount(0)
})

test('a quotation is written from the opportunity, its page names the opportunity, and confirming the order wins it', async ({ page }) => {
  await bridge(page, true)
  await page.goto('/crm/opportunities/2')
  await expect(page.getByTestId('crm-orders')).toBeVisible()
  await expect(page.getByTestId('crm-orders')).toContainText('لا توجد عروض أسعار لهذه الفرصة')
  await expect(page.getByTestId('crm-orders-win')).toBeVisible()
  // The package form steps aside: no sale action, and no sold outcome in the call form.
  await expect(page.getByTestId('crm-open-sale')).toHaveCount(0)
  await page.getByTestId('crm-call-form').getByRole('combobox').first().click()
  await expect(page.getByRole('option', { name: 'تم البيع' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await page.getByTestId('crm-order-add').click()
  await expect(page).toHaveURL(/\/sales\/\d+/)
  const id = Number(new URL(page.url()).pathname.split('/').at(-1))
  await expect(page.getByTestId('sales-customer')).toContainText('مؤسسة النخيل')
  await expect(page.getByTestId('sales-opportunity')).toBeVisible()
  await expect(page.getByTestId('sales-opportunity-link')).toHaveText('سارة القحطاني')
  await expect(page.getByTestId('sales-opportunity-link')).toHaveAttribute('href', '/crm/opportunities/2')

  const edited = await page.request.patch(`/api/v1/sales/orders/${id}`, { data: { lines: [{ kind: 'product', product_id: 1, quantity: 2 }] } })
  expect(edited.ok()).toBe(true)
  await page.reload()
  await page.getByTestId('sales-confirm').click()
  await expect(page.getByTestId('sales-opportunity-status')).toHaveText('مربوحة')
  expect(SalesOrderSchema.parse(await (await page.request.get(`/api/v1/sales/orders/${id}`)).json()).opportunity).toMatchObject({ id: 2, status: 'won' })

  await page.getByTestId('sales-opportunity-link').click()
  await expect(page).toHaveURL(/\/crm\/opportunities\/2$/)
  await expect(page.locator('main h1').locator('..')).toContainText('تم البيع')
  await expect(page.getByTestId('crm-won-amount')).toContainText('240')
  expect(await opportunity(page, 2)).toMatchObject({ status: 'won', final_price: 240, package: null })
  await expect(page.getByTestId('crm-order-list')).toContainText('مؤكَّد')
  // The order stays listed after a cancel, and the opportunity stays won with an amount of zero.
  expect((await page.request.post(`/api/v1/sales/orders/${id}/cancel`)).ok()).toBe(true)
  expect(await opportunity(page, 2)).toMatchObject({ status: 'won', final_price: 0 })
})

test('an opportunity without a customer asks for one first, and a lost one takes no quotation', async ({ page }) => {
  await bridge(page, true)
  await page.goto('/crm/opportunities/1')
  await expect(page.getByTestId('crm-order-add')).toHaveCount(0)
  await expect(page.getByTestId('crm-orders-blocked')).toContainText('اربط الفرصة بعميل أولًا')
  await expect(page.getByTestId('crm-open-quotation')).toHaveCount(0)

  await page.goto('/crm/opportunities/6')
  await expect(page.getByTestId('crm-order-add')).toHaveCount(0)
  await expect(page.getByTestId('crm-orders-blocked')).toContainText('مغلقة أو المؤرشفة')
})

test('a reader sees the quotations of the opportunity but cannot write one', async ({ page }) => {
  await bridge(page, true)
  expect((await page.request.post('/api/v1/crm/opportunities/2/orders', { data: {} })).ok()).toBe(true)
  await page.context().addCookies([{ name: 'mock_caps', value: 'reader', url: new URL(page.url()).origin }])
  await page.goto('/crm/opportunities/2')
  await expect(page.getByTestId('crm-order-list')).toContainText('مسودة')
  await expect(page.getByTestId('crm-order-add')).toHaveCount(0)
  await expect(page.getByTestId('crm-open-quotation')).toHaveCount(0)
})

test('the settings choose when an order wins the opportunity and for what amount', async ({ page }) => {
  await page.goto('/settings/apps/sales')
  await expect(page.getByTestId('sales-opportunity-win')).toHaveCount(0)
  await bridge(page, true)
  await page.goto('/settings/apps/sales')
  const win = page.getByTestId('sales-opportunity-win')
  const amount = page.getByTestId('sales-opportunity-amount')
  await expect(win.getByRole('radio', { name: /عند تأكيد الطلب/ })).toBeChecked()
  await expect(amount.getByRole('radio', { name: /قبل الضريبة/ })).toBeChecked()
  await win.getByText('يدويًا').click()
  await amount.getByText('بعد الضريبة').click()
  await page.getByRole('button', { name: /^حفظ/ }).first().click()
  await expect.poll(async () => (await (await page.request.get('/api/v1/sales/settings')).json()))
    .toMatchObject({ opportunity_win: 'manual', opportunity_win_amount: 'total' })

  // By hand, confirming the order leaves the opportunity open, and the package form is back.
  const created = SalesOrderSchema.parse(await (await page.request.post('/api/v1/crm/opportunities/2/orders', { data: {} })).json())
  await page.request.patch(`/api/v1/sales/orders/${created.id}`, { data: { lines: [{ kind: 'product', product_id: 1, quantity: 1 }] } })
  expect((await page.request.post(`/api/v1/sales/orders/${created.id}/confirm`)).ok()).toBe(true)
  expect(await opportunity(page, 2)).toMatchObject({ status: 'pending', win_by_order: false, can_quote: false })
  await page.goto('/crm/opportunities/2')
  await expect(page.getByTestId('crm-open-sale')).toBeVisible()
  await expect(page.getByTestId('crm-open-quotation')).toHaveCount(0)
  await page.getByTestId('crm-call-form').getByRole('combobox').first().click()
  await expect(page.getByRole('option', { name: 'تم البيع' })).toBeVisible()
})

test('a package win is refused while an order wins, and a caller who cannot quote is told to ask a sales manager', async ({ page }) => {
  await bridge(page, true, false)
  const won = await page.request.post('/api/v1/crm/opportunities/2/won', { data: { package_id: 1, final_price: 100 } })
  expect(won.status()).toBe(409)
  expect(await won.json()).toMatchObject({ code: 'conflict', details: { reason: 'crm_win_by_order' } })
  const sold = await page.request.post('/api/v1/crm/opportunities/2/calls', { data: { outcome_id: 3, package_id: 1, final_price: 100 } })
  expect(sold.status()).toBe(409)
  expect(await opportunity(page, 2)).toMatchObject({ status: 'pending', win_by_order: true, can_quote: false })

  await page.goto('/crm/opportunities/2')
  await expect(page.getByTestId('crm-quote-forbidden')).toContainText('اطلب من مدير المبيعات')
  await expect(page.getByTestId('crm-open-quotation')).toHaveCount(0)
  await expect(page.getByTestId('crm-open-sale')).toHaveCount(0)
})

test('writing a quotation for another agent\'s opportunity needs the right to assign, and the quotation goes back to the opportunity', async ({ page }) => {
  await bridge(page, true)
  await page.context().addCookies([{ name: 'mock_crm_assign', value: 'off', url: new URL(page.url()).origin }])
  const refused = await page.request.post('/api/v1/crm/opportunities/3/orders', { data: {} })
  expect(refused.status()).toBe(403)
  await page.context().clearCookies({ name: 'mock_crm_assign' })

  await page.goto('/crm/opportunities/2')
  await page.getByTestId('crm-order-add').click()
  await expect(page).toHaveURL(/\/sales\/\d+/)
  await expect(page.locator('main')).toContainText('S00')
  await page.getByRole('link', { name: /رجوع/ }).first().click()
  await expect(page).toHaveURL(/\/crm\/opportunities\/2$/)
})
