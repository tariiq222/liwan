import { test, expect, type Page } from '@playwright/test'

// Runs against the isolated synthetic stack (MODULE_UI_PREVIEW=1): sales-mock-routes.mjs keeps state, reset before each
// test. Seed: S00001 draft (mine, a section, a product and a note; its customer has no email), S00002 confirmed (another
// salesperson), S00003 cancelled, S00004 an online order, confirmed and locked, and four quotations already sent by another
// salesperson: S00005 (accept or decline), S00006 (accept with a signature), S00007 (expired) and S00008 (read only). `mock_caps=reader` drops every write capability and
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
  const reset = await page.request.post('/api/v1/public/sales/__mock/reset', { data: {} })
  expect(reset.ok()).toBe(true)
})

test('the list keeps its filters in the address and Back from a record returns to the same filtered list', async ({ page }) => {
  await page.goto('/sales')
  await expect(numbers(page)).toHaveText(['S00001', 'S00002', 'S00003', 'S00004', 'S00005', 'S00006', 'S00007', 'S00008'])

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
  for (const id of ['sales-edit', 'sales-confirm', 'sales-send', 'sales-pdf', 'sales-cancel', 'sales-lock', 'sales-unlock', 'sales-reopen', 'sales-assign-open']) {
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
  for (const id of ['sales-edit', 'sales-send', 'sales-confirm', 'sales-cancel', 'sales-duplicate', 'sales-pdf']) await expect(shown(id), id).toBeVisible()
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
  for (const id of ['sales-edit', 'sales-send', 'sales-confirm', 'sales-cancel', 'sales-duplicate']) await expect(page.getByTestId(id), id).toHaveCount(0)

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

test('a draft is sent to the customer, shows its answer once the customer answers, and goes back to a draft', async ({ page }) => {
  // S00001's customer has no email: the send is refused in words and the quotation stays a draft.
  await page.goto('/sales/1')
  await expect(page.getByTestId('sales-send')).toHaveText('إرسال للعميل')
  await page.getByTestId('sales-send').click()
  await expect(page.getByTestId('sales-action-error')).toContainText('ليس للعميل بريد إلكتروني')
  await expect(page.getByTestId('sales-answer-status')).toHaveCount(0)

  const created = await page.request.post('/api/v1/sales/orders', { data: { customer_id: 1, lines: [{ kind: 'product', product_id: 1, quantity: 1 }] } })
  const { id } = await created.json() as { id: number }
  await page.goto(`/sales/${id}`)
  await page.getByTestId('sales-send').click()
  await expect(page.getByTestId('sales-answer-status')).toHaveText('بانتظار العميل')
  await expect(page.locator('main').getByText('مُرسَل').first()).toBeVisible()
  await expect(page.getByTestId('sales-send')).toHaveText('إعادة الإرسال')
  await expect(page.getByTestId('sales-edit')).toHaveCount(0)
  await expect(page.getByTestId('sales-pdf')).toHaveAttribute('href', `/api/v1/sales/orders/${id}/pdf`)

  // The customer declines at the link; the record shows it after a reload.
  const declined = await page.request.post(`/api/v1/public/sales/quotations/${id}/decline`, { data: { access_token: `tok-${id}`, reason: 'السعر مرتفع' } })
  expect(declined.ok()).toBe(true)
  await page.reload()
  await expect(page.getByTestId('sales-answer-status')).toHaveText('رفض العرض')
  await expect(page.getByTestId('sales-answer-reason')).toContainText('السعر مرتفع')
  // A declined quotation is cancelled on the server: it is reopened, never sent again.
  await expect(page.getByTestId('sales-send')).toHaveCount(0)
  await expect(page.getByTestId('sales-send-refused')).toHaveCount(0)
  await expect(page.getByTestId('sales-reopen')).toBeVisible()
})

test('sending a quotation again asks first, because the customer\'s earlier answer is removed; cancelling the question sends nothing', async ({ page }) => {
  const sends: string[] = []
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/v1/sales/orders/5/send')) sends.push(request.url()) })
  const confirmation = page.getByTestId('inline-confirm')

  await page.goto('/sales/5')
  await page.getByTestId('sales-send').click()
  await expect(confirmation).toContainText('هل تريد إعادة إرسال S00005 للعميل؟')
  await expect(confirmation).toContainText('سيصل العميل بريد إلكتروني جديد. إن كان قد ردّ على العرض فسيُحذف ردّه وتوقيعه.')
  await page.getByTestId('inline-confirm-cancel').click()
  await expect(confirmation).toHaveCount(0)
  expect(sends).toEqual([])

  await page.getByTestId('sales-send').click()
  await page.getByTestId('inline-confirm-action').click()
  await expect(confirmation).toHaveCount(0)
  await expect(page.getByTestId('sales-answer-status')).toHaveText('بانتظار العميل')
  expect(sends).toHaveLength(1)

  // Only one question is open at a time: asking to cancel replaces the question about sending again.
  await page.getByTestId('sales-send').click()
  await page.getByTestId('sales-cancel').click()
  await expect(confirmation).toHaveCount(1)
  await expect(confirmation).toContainText('هل تريد إلغاء S00005؟')
})

test('a sent quotation can be reopened as a draft, an acceptance shows its signer, and an expired one is marked and cannot be confirmed', async ({ page }) => {
  await page.goto('/sales/5')
  await expect(page.getByTestId('sales-reopen')).toHaveText('إعادة إلى مسودة')
  await expect(page.getByTestId('sales-confirm')).toBeVisible()
  await expect(page.getByTestId('sales-send')).toHaveText('إعادة الإرسال')
  await page.getByTestId('sales-reopen').click()
  await expect(page.getByTestId('sales-edit')).toBeVisible()
  await expect(page.getByTestId('sales-answer-status')).toHaveCount(0)

  const accepted = await page.request.post('/api/v1/public/sales/quotations/6/accept', { data: { access_token: 'tok-6', signed_by: 'منى العتيبي', signature: 'iVBORw0KGgoAAAANSUhEUg', signature_method: 'drawn' } })
  expect(accepted.ok()).toBe(true)
  await page.goto('/sales/6')
  await expect(page.getByTestId('sales-answer-status')).toHaveText('قبل العرض')
  await expect(page.getByTestId('sales-answer-signer')).toContainText('منى العتيبي')
  await expect(page.getByTestId('sales-answer-signature-method')).toContainText('وقّع بالرسم')

  await page.goto('/sales/7')
  await expect(heading(page)).toHaveText('S00007')
  await expect(page.locator('main').getByText('منتهي الصلاحية').first()).toBeVisible()
  await expect(page.getByTestId('sales-confirm')).toHaveCount(0)
  await page.goto('/sales?state=quotations')
  await expect(page.getByTestId('sales-expired')).toHaveCount(1)
})

test('the quotation settings choose how the customer answers, and acceptance confirming the order needs an answer', async ({ page }) => {
  await page.goto('/settings/apps/sales')
  const confirms = page.getByTestId('sales-acceptance-confirms')
  await expect(page.getByTestId('sales-customer-answer').getByRole('radio', { name: /القبول أو الرفض/ })).toBeChecked()
  await expect(confirms).toBeEnabled()
  await page.getByTestId('sales-customer-answer').getByText('القراءة فقط').click()
  await expect(confirms).toBeDisabled()
  await page.getByTestId('sales-customer-answer').getByText('القبول بتوقيع').click()
  await expect(confirms).toBeEnabled()
  await confirms.click()
  await page.getByRole('button', { name: /^حفظ/ }).first().click()
  await expect.poll(async () => (await (await page.request.get('/api/v1/sales/settings')).json()))
    .toMatchObject({ customer_answer: 'accept_and_sign', acceptance_confirms: true })
})

test('the quotation settings choose whether an answered quotation can be sent again, and how the customer signs', async ({ page }) => {
  await page.goto('/settings/apps/sales')
  const methods = page.getByTestId('sales-signature-methods')
  const resend = page.getByTestId('sales-answered-resend')
  await expect(resend.getByRole('radio', { name: /السماح/ })).toBeChecked()
  await expect(methods.getByRole('radio', { name: /بالرسم أو بكتابة الاسم/ })).toBeChecked()
  // The way of signing only applies while the customer signs.
  await expect(methods.getByRole('radio', { name: /بالرسم فقط/ })).toBeDisabled()
  await page.getByTestId('sales-customer-answer').getByText('القبول بتوقيع').click()
  await methods.getByText('بالرسم فقط').click()
  await resend.getByText('المنع').click()
  await page.getByRole('button', { name: /^حفظ/ }).first().click()
  await expect.poll(async () => (await (await page.request.get('/api/v1/sales/settings')).json()))
    .toMatchObject({ customer_answer: 'accept_and_sign', signature_methods: 'draw', answered_resend: 'refuse' })
})

test('under the refuse setting an answered quotation has no send button, says why, and is sent again after it is reopened', async ({ page }) => {
  const settings = await (await page.request.get('/api/v1/sales/settings')).json() as { revision: number }
  expect((await page.request.patch('/api/v1/sales/settings', { data: { answered_resend: 'refuse', revision: settings.revision } })).ok()).toBe(true)
  const accepted = await page.request.post('/api/v1/public/sales/quotations/6/accept', { data: { access_token: 'tok-6', signed_by: 'منى العتيبي', signature: 'iVBORw0KGgoAAAANSUhEUg', signature_method: 'typed' } })
  expect(accepted.ok()).toBe(true)

  await page.goto('/sales/6')
  await expect(page.getByTestId('sales-answer-signature-method')).toContainText('وقّع بكتابة الاسم')
  await expect(page.getByTestId('sales-send')).toHaveCount(0)
  await expect(page.getByTestId('sales-send-refused')).toContainText('ردّ العميل على هذا العرض. أعد فتحه لإرساله من جديد.')
  const refused = await page.request.post('/api/v1/sales/orders/6/send')
  expect(refused.status()).toBe(409)
  expect(await refused.json()).toMatchObject({ code: 'quotation_answered' })

  await page.getByTestId('sales-reopen').click()
  await expect(page.getByTestId('sales-edit')).toBeVisible()
  await expect(page.getByTestId('sales-send-refused')).toHaveCount(0)
  await page.getByTestId('sales-send').click()
  await expect(page.getByTestId('sales-answer-status')).toHaveText('بانتظار العميل')
})
