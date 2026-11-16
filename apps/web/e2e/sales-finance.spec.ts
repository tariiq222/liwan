import { test, expect, type Page } from '@playwright/test'
import { FinanceInvoiceDetailSchema, SalesOrderSchema, SalesSettingsSchema } from '@liwan/contracts'
import { MOCK_STACK_ONLY } from './support/mock-pages'

// Runs against the isolated synthetic stack (MODULE_UI_PREVIEW=1): the Finance bridge to Sales (sales-finance-mock-routes.mjs).
// `POST /api/v1/public/sales/__mock/finance {on: true}` puts Finance in the plan; the Sales mock then reports `invoicing` and the
// down payment setting, and keeps the invoices it makes (ids from 9001). `mock_finance=read` reads finance invoices without
// the right to make one, `mock_finance=hidden` reads none. Seed: S00002 is a confirmed staff order, S00004 an online one.
test.skip(process.env.E2E_PROJECT_POPUPS !== '1', MOCK_STACK_ONLY)

async function login(page: Page) {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

// The amounts the page shows, formatted as the page does in Arabic (the mock's order currency is SAR).
const money = (amount: number) => new Intl.NumberFormat('ar', { style: 'currency', currency: 'SAR' }).format(amount)
const finance = async (page: Page, on: boolean) => expect((await page.request.post('/api/v1/public/sales/__mock/finance', { data: { on } })).ok()).toBe(true)
const order = async (page: Page, id: number) => SalesOrderSchema.parse(await (await page.request.get(`/api/v1/sales/orders/${id}`)).json())

/** A confirmed staff order of 276 (two of the first package, taxed), made through the same routes the pages use. */
async function confirmedOrder(page: Page) {
  const created = SalesOrderSchema.parse(await (await page.request.post('/api/v1/sales/orders', { data: { customer_id: 2, lines: [{ kind: 'product', product_id: 1, quantity: 2 }] } })).json())
  expect((await page.request.post(`/api/v1/sales/orders/${created.id}/confirm`)).ok()).toBe(true)
  return created.id
}

async function useCookie(page: Page, name: string, value: string) {
  await page.context().addCookies([{ name, value, url: new URL(page.url()).origin }])
}

test.beforeEach(async ({ page }) => {
  await login(page)
  expect((await page.request.post('/api/v1/public/sales/__mock/reset', { data: {} })).ok()).toBe(true)
})

test('without Finance an order shows no invoicing and the settings have no invoicing card', async ({ page }) => {
  await page.goto('/sales/2')
  await expect(page.getByTestId('sales-customer')).toBeVisible()
  await expect(page.getByTestId('sales-invoicing')).toHaveCount(0)
  await expect(page.getByTestId('sales-invoice-open')).toHaveCount(0)
  expect((await order(page, 2)).invoicing).toBeUndefined()
  await page.goto('/settings/apps/sales')
  await expect(page.getByTestId('sales-invoicing-down-payment')).toHaveCount(0)
  expect(SalesSettingsSchema.parse(await (await page.request.get('/api/v1/sales/settings')).json()).invoice_down_payment).toBeUndefined()
})

test('the whole order becomes a draft invoice that opens in finance and comes back to the order', async ({ page }) => {
  await finance(page, true)
  await page.goto('/sales/2')
  await expect(page.getByTestId('sales-invoicing-status')).toHaveText('جاهز للفوترة')
  await expect(page.getByTestId('sales-invoicing-empty')).toBeVisible()
  await expect(page.getByTestId('sales-invoicing-invoiced')).toHaveText(money(0))
  await expect(page.getByTestId('sales-invoicing-toInvoice')).toHaveText(money(552))
  await expect(page.getByTestId('sales-invoicing-paid')).toHaveText(money(0))
  const keys: string[] = []
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/v1/sales/orders/2/invoices')) keys.push(request.headers()['idempotency-key'] ?? '') })
  await page.getByTestId('sales-invoice-open').click()
  await expect(page.getByTestId('sales-invoice-form')).toBeVisible()
  await expect(page.getByTestId('sales-invoice-method').getByRole('radio', { name: /الطلب كله/ })).toBeChecked()
  await page.getByTestId('sales-invoice-save').click()

  await expect(page.getByTestId('sales-invoice-created')).toContainText('أُنشئت فاتورة مسودة')
  expect(keys).toHaveLength(1)
  expect(keys[0]).toMatch(/^[A-Za-z0-9_.:-]{8,128}$/)
  await expect(page.getByTestId('sales-invoicing-status')).toHaveText('مفوتر بالكامل')
  await expect(page.getByTestId('sales-invoice-9001').getByTestId('sales-invoice-state')).toHaveText('مسودة')
  await expect(page.getByTestId('sales-invoicing-drafted')).toBeVisible()
  await expect(page.getByTestId('sales-invoice-open')).toHaveCount(0)
  const created = await order(page, 2)
  expect(created.invoicing).toMatchObject({ status: 'invoiced', amount_to_invoice: 0, can_invoice: false, can_down_payment: false })
  await expect(page.getByTestId('sales-invoice-created-link')).toHaveAttribute('href', '/finance/sales/invoices/9001?returnTo=/sales/2')

  await page.getByTestId('sales-invoice-link').first().click()
  await expect(page).toHaveURL(/\/finance\/sales\/invoices\/9001\?returnTo=(?:%2F|\/)sales(?:%2F|\/)2$/)
  await expect(page.getByTestId('finance-invoice-source-order')).toHaveText('S00002')
  expect(FinanceInvoiceDetailSchema.parse(await (await page.request.get('/api/v1/finance/invoices/9001')).json()).source_order).toEqual({ id: 2, number: 'S00002' })
  await page.getByTestId('finance-invoice-source-order').click()
  await expect(page).toHaveURL(/\/sales\/2\?returnTo=(?:%2F|\/)finance(?:%2F|\/)sales(?:%2F|\/)invoices(?:%2F|\/)9001$/)
  await page.getByRole('link', { name: /رجوع/ }).first().click()
  await expect(page).toHaveURL(/\/finance\/sales\/invoices\/9001/)
  // A round trip keeps no nested context: back from the invoice now goes to its own list.
  await page.getByRole('link', { name: /رجوع/ }).first().click()
  await expect(page).toHaveURL(/\/finance\/sales\/invoices$/)

  // Straight from the order, Back from the invoice returns to the order.
  await page.goto('/sales/2')
  await page.getByTestId('sales-invoice-link').first().click()
  await expect(page).toHaveURL(/\/finance\/sales\/invoices\/9001/)
  await page.getByRole('link', { name: /رجوع/ }).first().click()
  await expect(page).toHaveURL(/\/sales\/2$/)
})

test('a down payment by percent or by amount is checked before it is sent, and the final invoice takes what is left', async ({ page }) => {
  await finance(page, true)
  const id = await confirmedOrder(page)
  await page.goto(`/sales/${id}`)
  await page.getByTestId('sales-invoice-open').click()
  await page.getByTestId('sales-invoice-method').getByText('دفعة مقدمة بنسبة').click()
  const percent = page.getByTestId('sales-invoice-percent')
  // The field keeps a number inside its bounds, so what the form refuses is an empty one.
  await percent.fill('')
  await page.getByTestId('sales-invoice-save').click()
  await expect(page.getByTestId('sales-invoice-form')).toContainText('اكتب نسبة بين 1 و100')
  expect((await order(page, id)).invoicing?.invoices).toHaveLength(0)
  // The number field sometimes drops a value typed right after its error appears, so the entry is repeated until it holds.
  await expect(async () => {
    await percent.fill('25')
    await percent.press('Tab')
    await expect(percent).toHaveValue('25', { timeout: 500 })
  }).toPass()
  await page.getByTestId('sales-invoice-save').click()
  await expect(page.getByTestId('sales-invoice-created')).toBeVisible()
  await expect(page.getByTestId('sales-invoicing-status')).toHaveText('مفوتر جزئيًا')
  await expect(page.getByTestId('sales-invoicing-drafted')).toContainText('69')
  await expect(page.getByTestId('sales-invoicing-toInvoice')).toContainText('207')

  await page.getByTestId('sales-invoice-open').click()
  await page.getByTestId('sales-invoice-method').getByText('دفعة مقدمة بمبلغ').click()
  await page.getByTestId('sales-invoice-amount').fill('')
  await page.getByTestId('sales-invoice-save').click()
  await expect(page.getByTestId('sales-invoice-form')).toContainText('اكتب مبلغًا أكبر من صفر')
  await expect(async () => {
    await page.getByTestId('sales-invoice-amount').fill('100')
    await page.getByTestId('sales-invoice-amount').press('Tab')
    await expect(page.getByTestId('sales-invoice-amount')).toHaveValue(/^100(\.00)?$/, { timeout: 500 })
  }).toPass()
  await page.getByTestId('sales-invoice-save').click()
  await expect(page.getByTestId('sales-invoice-list').locator('li')).toHaveCount(2)
  await expect(page.getByTestId('sales-invoicing-toInvoice')).toContainText('107')

  await page.getByTestId('sales-invoice-open').click()
  await page.getByTestId('sales-invoice-method').getByText('الطلب كله').click()
  await page.getByTestId('sales-invoice-save').click()
  await expect(page.getByTestId('sales-invoicing-status')).toHaveText('مفوتر بالكامل')
  const done = await order(page, id)
  expect(done.invoicing?.invoices.map(invoice => [invoice.kind, invoice.amount_total])).toEqual([['invoice', 107], ['down_payment', 100], ['down_payment', 69]])
  // What the form cannot stop (a stale page, another client) the server refuses with its own codes.
  const stale = await page.request.post(`/api/v1/sales/orders/${id}/invoices`, { data: { method: 'percent', percent: 10 } })
  expect(stale.status()).toBe(422)
  expect(await stale.json()).toMatchObject({ code: 'nothing_to_invoice' })
  const other = await confirmedOrder(page)
  const beyond = await page.request.post(`/api/v1/sales/orders/${other}/invoices`, { data: { method: 'amount', amount: 300 } })
  expect(beyond.status()).toBe(422)
  expect(await beyond.json()).toMatchObject({ code: 'invalid', field: 'amount', details: { max_amount: 276 } })
})

test('posting and paying in finance changes what the order says it invoiced and was paid', async ({ page }) => {
  await finance(page, true)
  const id = await confirmedOrder(page)
  const made = await page.request.post(`/api/v1/sales/orders/${id}/invoices`, { data: { method: 'order' } })
  expect(made.ok()).toBe(true)
  const invoice = SalesOrderSchema.parse(await made.json()).invoicing!.invoices[0]!
  expect((await page.request.post(`/api/v1/finance/invoices/${invoice.id}/post`)).ok()).toBe(true)
  expect((await page.request.post('/api/v1/public/sales/__mock/invoice-paid', { data: { id: invoice.id, amount: 100 } })).ok()).toBe(true)
  await page.goto(`/sales/${id}`)
  await expect(page.getByTestId('sales-invoicing-invoiced')).toHaveText(money(276))
  await expect(page.getByTestId('sales-invoicing-paid')).toHaveText(money(100))
  await expect(page.getByTestId('sales-invoice-state')).toHaveText('مُصدرة')
  // A posted invoice keeps the order from being cancelled here: the invoice is credited in finance first.
  await expect(page.getByTestId('sales-cancel')).toHaveCount(0)
  await expect(page.getByTestId('sales-cancel-blocked')).toContainText('إشعارًا دائنًا')
  const cancelled = await page.request.post(`/api/v1/sales/orders/${id}/cancel`)
  expect(cancelled.status()).toBe(403)
  expect(await cancelled.json()).toMatchObject({ code: 'transition_forbidden' })
})

test('a posted credit note is taken off what the order shows as paid', async ({ page }) => {
  await finance(page, true)
  const id = await confirmedOrder(page)
  const invoice = SalesOrderSchema.parse(await (await page.request.post(`/api/v1/sales/orders/${id}/invoices`, { data: { method: 'order' } })).json()).invoicing!.invoices[0]!
  expect((await page.request.post(`/api/v1/finance/invoices/${invoice.id}/post`)).ok()).toBe(true)
  expect((await page.request.post('/api/v1/public/sales/__mock/invoice-paid', { data: { id: invoice.id, amount: 100 } })).ok()).toBe(true)
  // The credit note settles the 176 the invoice still owed, so the 100 paid before it stays paid.
  expect((await page.request.post('/api/v1/public/sales/__mock/credit-note', { data: { id: invoice.id, amount: 276 } })).ok()).toBe(true)
  await page.goto(`/sales/${id}`)
  await expect(page.getByTestId('sales-invoicing-credited')).toHaveText(money(276))
  await expect(page.getByTestId('sales-invoicing-paid')).toHaveText(money(100))
  expect((await order(page, id)).invoicing).toMatchObject({ amount_paid: 100, amount_credited: 276, amount_invoiced: 276 })
})

test('a draft invoice keeps a caller who cannot manage invoices from cancelling, and the page says why', async ({ page }) => {
  await finance(page, true)
  const id = await confirmedOrder(page)
  expect((await page.request.post(`/api/v1/sales/orders/${id}/invoices`, { data: { method: 'percent', percent: 50 } })).ok()).toBe(true)
  await page.goto(`/sales/${id}`)
  await expect(page.getByTestId('sales-cancel')).toBeVisible()
  await expect(page.getByTestId('sales-cancel-blocked')).toHaveCount(0)
  await useCookie(page, 'mock_finance', 'retained')
  await page.goto(`/sales/${id}`)
  await expect(page.getByTestId('sales-cancel')).toHaveCount(0)
  await expect(page.getByTestId('sales-cancel-blocked')).toContainText('فاتورة مسودة')
  expect((await page.request.post(`/api/v1/sales/orders/${id}/cancel`)).status()).toBe(403)
})

test('cancelling an order cancels its draft invoices', async ({ page }) => {
  await finance(page, true)
  const id = await confirmedOrder(page)
  expect((await page.request.post(`/api/v1/sales/orders/${id}/invoices`, { data: { method: 'percent', percent: 50 } })).ok()).toBe(true)
  await page.goto(`/sales/${id}`)
  await page.getByTestId('sales-cancel').click()
  await page.getByRole('button', { name: 'إلغاء المستند' }).click()
  await expect(page.getByTestId('sales-invoice-state')).toHaveText('ملغاة')
  expect((await order(page, id)).invoicing).toMatchObject({ status: 'none', amount_drafted: 0, amount_to_invoice: 0 })
})

test('an online order lists its invoices but offers none, and a reader of finance cannot make one', async ({ page }) => {
  await finance(page, true)
  await page.goto('/sales/4')
  await expect(page.getByTestId('sales-invoicing-online')).toContainText('يُفوتر الطلب الإلكتروني عند دفعه')
  await expect(page.getByTestId('sales-invoice-open')).toHaveCount(0)
  const refused = await page.request.post('/api/v1/sales/orders/4/invoices', { data: { method: 'order' } })
  expect(refused.status()).toBe(403)
  expect(await refused.json()).toMatchObject({ code: 'forbidden', details: { reason: 'online_order' } })

  await useCookie(page, 'mock_finance', 'read')
  await page.goto('/sales/2')
  await expect(page.getByTestId('sales-invoicing')).toBeVisible()
  await expect(page.getByTestId('sales-invoice-open')).toHaveCount(0)
  expect((await page.request.post('/api/v1/sales/orders/2/invoices', { data: { method: 'order' } })).status()).toBe(403)
})

test('an open invoice form closes when a refetch takes the right to invoice away', async ({ page }) => {
  await finance(page, true)
  const id = await confirmedOrder(page)
  await page.goto(`/sales/${id}`)
  await page.getByTestId('sales-invoice-open').click()
  await expect(page.getByTestId('sales-invoice-form')).toBeVisible()
  // The caller loses the finance right while the form is open; the refused save refetches the order, which no longer offers an invoice.
  await useCookie(page, 'mock_finance', 'read')
  await page.getByTestId('sales-invoice-save').click()
  await expect(page.getByTestId('sales-invoice-form')).toHaveCount(0)
  await expect(page.getByTestId('sales-invoice-open')).toHaveCount(0)
  expect((await order(page, id)).invoicing?.invoices).toHaveLength(0)
})

test('without the right to read finance invoices the order shows no invoicing at all', async ({ page }) => {
  await finance(page, true)
  expect((await page.request.post('/api/v1/sales/orders/2/invoices', { data: { method: 'order' } })).ok()).toBe(true)
  await useCookie(page, 'mock_finance', 'hidden')
  await page.goto('/sales/2')
  await expect(page.getByTestId('sales-customer')).toBeVisible()
  await expect(page.getByTestId('sales-invoicing')).toHaveCount(0)
  await expect(page.getByTestId('sales-invoice-link')).toHaveCount(0)
  expect((await order(page, 2)).invoicing).toBeNull()
})

test('the actor setting decides whether a colleague invoices the order', async ({ page }) => {
  await finance(page, true)
  // Under `all` visibility an agent reads a colleague's order; the actor setting decides whether they may invoice it.
  const current = SalesSettingsSchema.parse(await (await page.request.get('/api/v1/sales/settings')).json())
  expect((await page.request.patch('/api/v1/sales/settings', { data: { revision: current.revision, visibility: 'all' } })).ok()).toBe(true)
  await useCookie(page, 'mock_sales', 'agent')
  // S00002 is another salesperson's: an agent who may not assign orders neither sees the button nor is let in.
  await page.goto('/sales/2')
  await expect(page.getByTestId('sales-invoicing')).toBeVisible()
  await expect(page.getByTestId('sales-invoice-open')).toHaveCount(0)
  const refused = await page.request.post('/api/v1/sales/orders/2/invoices', { data: { method: 'order' } })
  expect(refused.status()).toBe(403)
  expect(await refused.json()).toMatchObject({ code: 'forbidden', details: { reason: 'not_the_salesperson' } })

  await page.context().clearCookies({ name: 'mock_sales' })
  await page.goto('/settings/apps/sales')
  const actor = page.getByTestId('sales-invoicing-actor')
  await expect(actor.getByRole('radio', { name: /مندوب الطلب فقط/ })).toBeChecked()
  await actor.getByText('أي موظف فوترة').click()
  await page.getByRole('button', { name: /^حفظ/ }).first().click()
  await expect.poll(async () => (await (await page.request.get('/api/v1/sales/settings')).json())).toMatchObject({ invoice_actor: 'any_biller' })

  await useCookie(page, 'mock_sales', 'agent')
  await page.goto('/sales/2')
  await expect(page.getByTestId('sales-invoice-open')).toBeVisible()
  expect((await page.request.post('/api/v1/sales/orders/2/invoices', { data: { method: 'order' } })).ok()).toBe(true)
})

test('the setting that closes down payments leaves only the whole order', async ({ page }) => {
  await finance(page, true)
  await page.goto('/settings/apps/sales')
  const choice = page.getByTestId('sales-invoicing-down-payment')
  await expect(choice.getByRole('radio', { name: /مسموحة/ })).toBeChecked()
  await choice.getByText('مغلقة').click()
  await page.getByRole('button', { name: /^حفظ/ }).first().click()
  await expect.poll(async () => (await (await page.request.get('/api/v1/sales/settings')).json())).toMatchObject({ invoice_down_payment: 'refuse' })

  const id = await confirmedOrder(page)
  await page.goto(`/sales/${id}`)
  await page.getByTestId('sales-invoice-open').click()
  await expect(page.getByTestId('sales-invoice-method').getByRole('radio')).toHaveCount(1)
  await expect(page.getByTestId('sales-invoice-method')).not.toContainText('دفعة مقدمة')
  const refused = await page.request.post(`/api/v1/sales/orders/${id}/invoices`, { data: { method: 'percent', percent: 10 } })
  expect(refused.status()).toBe(422)
  expect(await refused.json()).toMatchObject({ code: 'down_payment_refused', field: 'method' })
})
