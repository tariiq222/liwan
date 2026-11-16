import { test, expect, type Page } from '@playwright/test'
import { SalesOrderSchema, SalesSettingsPresetListSchema, SalesSettingsSchema, SalesTemplateListSchema, SalesTemplateSchema } from '@liwan/contracts'
import { MOCK_STACK_ONLY } from './support/mock-pages'

// Runs against the isolated synthetic stack (MODULE_UI_PREVIEW=1): sales-templates-mock-routes.mjs keeps the quotation templates
// and the sector presets, reset with the Sales mock before each test. Seed templates: 1 "عرض خدمات قياسي" (14 days, terms, a
// section, two products and a note), 2 "توريد شهري" (no validity), 3 "قالب فيه منتج غير متاح" (its product is gone) and the
// archived 4 "قالب قديم". `mock_caps=reader` drops every write capability, `mock_sales=agent` keeps the agent role (no settings).
test.skip(process.env.E2E_PROJECT_POPUPS !== '1', MOCK_STACK_ONLY)

const TEMPLATES = '/settings/apps/sales/templates'

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

const links = (page: Page) => page.getByTestId('sales-template-link')
const panel = (page: Page) => page.getByRole('dialog')
const heading = (page: Page) => page.locator('main h1')
const settings = async (page: Page) => SalesSettingsSchema.parse(await (await page.request.get('/api/v1/sales/settings')).json())
const order = async (page: Page, id: number) => SalesOrderSchema.parse(await (await page.request.get(`/api/v1/sales/orders/${id}`)).json())

test.beforeEach(async ({ page }) => {
  await login(page)
  const reset = await page.request.post('/api/v1/public/sales/__mock/reset', { data: {} })
  expect(reset.ok()).toBe(true)
})

test('the templates list shows the active templates, marks the one that needs attention and lists the archived ones on request', async ({ page }) => {
  await page.goto(TEMPLATES)
  await expect(heading(page)).toHaveText('قوالب عروض الأسعار')
  await expect(links(page)).toHaveText(['توريد شهري', 'عرض خدمات قياسي', 'قالب فيه منتج غير متاح'])
  await expect(page.getByTestId('sales-template-unusable')).toHaveCount(1)

  await page.getByTestId('sales-template-search').fill('خدمات')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/q=/)
  await expect(links(page)).toHaveText(['عرض خدمات قياسي'])
  await page.goto(TEMPLATES)

  await page.getByTestId('sales-template-archived').click()
  await expect(page).toHaveURL(/archived=1/)
  await expect(links(page)).toHaveText(['قالب قديم'])
  const filtered = page.url()
  await links(page).first().click()
  await expect(heading(page)).toHaveText('قالب قديم')
  await page.goBack()
  await expect(page).toHaveURL(filtered)
})

test('a template is created in the panel over its list, with a product, a section and a note, and Escape returns to the list', async ({ page }) => {
  await page.goto(`${TEMPLATES}/new`)
  await expect(panel(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/templates$/)

  await page.getByTestId('sales-template-new').click()
  const form = panel(page)
  await expect(form).toBeVisible()
  await form.getByTestId('sales-template-name').fill('قالب الاختبار')
  await form.getByTestId('sales-template-validity').fill('10')
  await form.getByTestId('sales-template-terms').fill('شروط القالب')
  await form.getByTestId('sales-line-0').getByTestId('product-picker-search').click()
  await form.getByTestId('sales-line-0').getByText('باقة أساسية').first().click()
  await form.getByTestId('sales-line-quantity-0').fill('3')
  // A template line has no discount, price or amount.
  await expect(form.getByTestId('sales-line-discount-0')).toHaveCount(0)
  await form.getByTestId('sales-line-add-section').click()
  await form.getByTestId('sales-line-name-1').fill('قسم الخدمات')
  await form.getByTestId('sales-template-submit').click()

  await expect(page).toHaveURL(/\/templates\/10/)
  await expect(heading(page)).toHaveText('قالب الاختبار')
  await expect(page.getByTestId('sales-template-lines')).toContainText('باقة أساسية')
  await expect(page.getByTestId('sales-template-lines')).toContainText('قسم الخدمات')
  await expect(page.getByTestId('sales-template-terms')).toHaveText('شروط القالب')
  const saved = SalesTemplateSchema.parse(await (await page.request.get('/api/v1/sales/templates/10')).json())
  expect(saved).toMatchObject({ name: 'قالب الاختبار', validity_days: 10, usable: true, archived: false })
  expect(saved.lines.map(line => [line.kind, line.quantity])).toEqual([['product', 3], ['section', 0]])
  await page.goBack()
  await expect(page).not.toHaveURL(/\/templates\/new/)
})

test('an empty create form names what is missing and a refused product is shown at its line', async ({ page }) => {
  await page.goto(`${TEMPLATES}/new`)
  const form = panel(page)
  await form.getByTestId('sales-template-submit').click()
  await expect(form.getByText('اكتب اسم القالب')).toBeVisible()
  await expect(form.getByTestId('sales-line-0').getByText('اختر المنتج')).toBeVisible()
  await expect(page).toHaveURL(/\/templates\/new/)
})

test('a template is edited on its own page and the record shows the change', async ({ page }) => {
  await page.goto(`${TEMPLATES}/1`)
  await expect(heading(page)).toHaveText('عرض خدمات قياسي')
  await expect(page.getByTestId('sales-template-validity')).toContainText('14')
  await page.getByTestId('sales-template-edit').click()
  await expect(page).toHaveURL(/\/templates\/1\/edit/)
  await page.getByTestId('sales-template-name').fill('عرض خدمات معدّل')
  await page.getByTestId('sales-line-remove-1').click()
  await page.getByTestId('sales-template-submit').click()
  await expect(page).toHaveURL(/\/templates\/1(\?|$)/)
  await expect(heading(page)).toHaveText('عرض خدمات معدّل')
  const saved = SalesTemplateSchema.parse(await (await page.request.get('/api/v1/sales/templates/1')).json())
  expect(saved.lines).toHaveLength(3)
  // The text staff wrote on a product line goes through an edit that never touched it.
  expect(saved.lines.map(line => line.name)).toEqual(['نطاق العمل', 'ساعتان أسبوعيًا', 'يبدأ التنفيذ خلال أسبوع من التأكيد.'])
  await page.goBack()
  await expect(page).not.toHaveURL(/\/edit/)
})

test('archiving asks first, leaves the pick list, and a restored template is back; an archived one is not edited', async ({ page }) => {
  await page.goto(`${TEMPLATES}/2`)
  await page.getByTestId('sales-template-archive').click()
  await page.getByRole('button', { name: 'أرشفة' }).last().click()
  await expect(page.getByTestId('sales-template-restore')).toBeVisible()
  await expect(page.getByTestId('sales-template-edit')).toHaveCount(0)
  expect(SalesTemplateListSchema.parse(await (await page.request.get('/api/v1/sales/templates')).json()).items.map(item => item.id)).toEqual([1, 3])

  await page.goto(`${TEMPLATES}/2/edit`)
  await expect(page.getByText('يُسترجع القالب المؤرشف قبل تعديله.')).toBeVisible()

  await page.goto(`${TEMPLATES}/2`)
  await page.getByTestId('sales-template-restore').click()
  await expect(page.getByTestId('sales-template-edit')).toBeVisible()
  expect(SalesTemplateListSchema.parse(await (await page.request.get('/api/v1/sales/templates')).json()).total).toBe(3)
})

test('a template whose product is gone says so on its page', async ({ page }) => {
  await page.goto(`${TEMPLATES}/3`)
  await expect(page.getByTestId('sales-template-unusable-note')).toBeVisible()
  await expect(page.getByTestId('sales-template-line-unusable')).toHaveCount(1)
})

test('a quotation starts from a template: the lines come from it and are priced when the quotation is saved', async ({ page }) => {
  await page.goto('/sales/new')
  const form = panel(page)
  await form.getByText('مؤسسة النخيل').first().click()
  await form.getByTestId('sales-template-pick').click()
  // The template whose product is gone shows but cannot be chosen.
  await expect(page.getByRole('option', { name: /قالب فيه منتج غير متاح/ })).toHaveAttribute('data-disabled', '')
  await page.getByRole('option', { name: 'عرض خدمات قياسي' }).click()
  await expect(form.getByTestId('sales-lines')).toHaveCount(0)
  await form.getByTestId('sales-submit').click()

  await expect(page).toHaveURL(/\/sales\/100/)
  const saved = await order(page, 100)
  expect(saved.lines.map(line => [line.kind, line.name])).toEqual([['section', 'نطاق العمل'], ['product', 'باقة أساسية'], ['product', 'ساعتان أسبوعيًا'], ['note', 'يبدأ التنفيذ خلال أسبوع من التأكيد.']])
  expect(saved.lines[1]).toMatchObject({ quantity: 2, unit_price: 120, discount_percent: 0 })
  expect(saved.validity_date).toBe('2026-11-28')
  expect(saved.terms).toBe('الدفع خلال 14 يومًا من تاريخ التأكيد.')
  await expect(page.getByTestId('sales-lines-panel')).toContainText('نطاق العمل')
})

test('a template of no validity falls back to the settings, and the form terms win over the template terms', async ({ page }) => {
  await page.goto('/sales/new')
  const form = panel(page)
  await form.getByText('مؤسسة النخيل').first().click()
  await form.getByTestId('sales-template-pick').click()
  await page.getByRole('option', { name: 'توريد شهري' }).click()
  await form.getByTestId('sales-terms').fill('شروط خاصة')
  await form.getByTestId('sales-submit').click()
  await expect(page).toHaveURL(/\/sales\/100/)
  const saved = await order(page, 100)
  expect(saved.terms).toBe('شروط خاصة')
  expect(saved.validity_date).toBe('2026-12-14')
  expect(saved.lines).toHaveLength(1)
})

test('choosing no template again brings the hand-made lines back', async ({ page }) => {
  await page.goto('/sales/new')
  const form = panel(page)
  await form.getByTestId('sales-template-pick').click()
  await page.getByRole('option', { name: 'توريد شهري' }).click()
  await expect(form.getByTestId('sales-lines')).toHaveCount(0)
  await form.getByTestId('sales-template-pick').click()
  await page.getByRole('option', { name: 'بلا قالب' }).click()
  await expect(form.getByTestId('sales-lines')).toBeVisible()
})

test('a reader and an agent never manage templates, and an agent still starts a quotation from one', async ({ page }) => {
  await useCookie(page, 'mock_sales', 'agent')
  const status = async (method: 'get' | 'post' | 'patch', path: string, data?: object) => (await page.request[method](path, data ? { data } : undefined)).status()
  expect(await status('get', '/api/v1/sales/templates')).toBe(200)
  expect(await status('get', '/api/v1/sales/templates?archived=true')).toBe(403)
  expect(await status('post', '/api/v1/sales/templates', { name: 'x', lines: [] })).toBe(403)
  expect(await status('post', '/api/v1/sales/templates/1/archive')).toBe(403)
  expect(await status('get', '/api/v1/sales/settings/presets')).toBe(403)
  await page.goto('/sales/new')
  await expect(panel(page).getByTestId('sales-template-pick')).toBeVisible()

  await page.context().clearCookies({ name: 'mock_sales' })
  await useCookie(page, 'mock_caps', 'reader')
  expect(await status('get', '/api/v1/sales/templates')).toBe(403)
  await page.goto(TEMPLATES)
  await expect(page.getByText('ليس لديك صلاحية').first()).toBeVisible()
  await expect(links(page)).toHaveCount(0)
})

test('the presets card shows what a preset changes, writes nothing until confirmed and then matches', async ({ page }) => {
  await page.goto('/settings/apps/sales')
  const card = page.getByTestId('sales-presets')
  await expect(card).toBeVisible()
  const before = await settings(page)
  expect(before).toMatchObject({ visibility: 'own', validity_days: 30, answered_resend: 'allow' })

  await card.getByText('مقاولات ومشاريع', { exact: true }).click()
  const preview = page.getByTestId('sales-preset-preview')
  await expect(preview).toBeVisible()
  await expect(page.getByTestId('sales-preset-change-visibility')).toContainText('كل المستندات')
  await expect(page.getByTestId('sales-preset-change-answered_resend')).toBeVisible()
  // The default terms are never part of a preset.
  await expect(page.getByTestId('sales-preset-change-default_terms')).toHaveCount(0)
  expect((await settings(page)).visibility).toBe('own')

  await page.getByRole('button', { name: 'تطبيق القالب' }).click()
  await page.getByRole('button', { name: 'تطبيق القالب' }).first().click()
  await expect.poll(async () => (await settings(page)).visibility).toBe('all')
  const after = await settings(page)
  expect(after).toMatchObject({ validity_days: 60, discount_limit_percent: 3, customer_answer: 'accept_and_sign', answered_resend: 'refuse', signature_methods: 'draw', revision: before.revision + 1, default_terms: before.default_terms })

  await card.getByText('مقاولات ومشاريع', { exact: true }).click()
  await expect(page.getByTestId('sales-preset-same')).toBeVisible()
  const presets = SalesSettingsPresetListSchema.parse(await (await page.request.get('/api/v1/sales/settings/presets')).json())
  expect(presets.items.filter(item => item.matches).map(item => item.key)).toEqual(['contracting'])
})

test('the presets hold the choices of a bridge only while the tenant carries it', async ({ page }) => {
  const keys = async () => Object.keys(SalesSettingsPresetListSchema.parse(await (await page.request.get('/api/v1/sales/settings/presets')).json()).items[0]!.values)
  expect(await keys()).toContain('payment_to_confirm')
  expect(await keys()).not.toContain('invoice_actor')
  expect((await page.request.post('/api/v1/public/sales/__mock/finance', { data: { on: true } })).ok()).toBe(true)
  expect(await keys()).toContain('invoice_actor')
  await useCookie(page, 'mock_payments', 'off')
  expect(await keys()).not.toContain('payment_to_confirm')

  await page.context().clearCookies({ name: 'mock_payments' })
  await page.goto('/settings/apps/sales')
  await page.getByTestId('sales-presets').getByText('تجارة وتجزئة', { exact: true }).click()
  await expect(page.getByTestId('sales-preset-change-invoice_down_payment')).toBeVisible()
  await expect(page.getByTestId('sales-preset-change-payment_to_confirm')).toBeVisible()
})

test('a branch manager reads the presets and cannot apply one, and a stale apply asks to reload', async ({ page }) => {
  await useCookie(page, 'mock_sales', 'branch')
  await page.goto('/settings/apps/sales')
  await expect(page.getByTestId('sales-presets')).toBeVisible()
  await expect(page.getByRole('button', { name: 'تطبيق القالب' })).toHaveCount(0)

  await page.context().clearCookies({ name: 'mock_sales' })
  await page.goto('/settings/apps/sales')
  await page.getByTestId('sales-presets').getByText('تجارة وتجزئة', { exact: true }).click()
  const current = await settings(page)
  // Another session saves first, so the revision this page read is stale.
  expect((await page.request.patch('/api/v1/sales/settings', { data: { validity_days: 31, revision: current.revision } })).ok()).toBe(true)
  await page.getByRole('button', { name: 'تطبيق القالب' }).click()
  await page.getByRole('button', { name: 'تطبيق القالب' }).first().click()
  await expect(page.getByRole('button', { name: 'تحميل القيم الحالية' })).toBeVisible()
  expect((await settings(page)).visibility).toBe('own')
})

test('a template that stops being usable after it was chosen refuses the quotation and names the product', async ({ page }) => {
  await page.goto('/sales/new')
  const form = panel(page)
  await form.getByText('مؤسسة النخيل').first().click()
  await form.getByTestId('sales-template-pick').click()
  await page.getByRole('option', { name: 'عرض خدمات قياسي' }).click()
  expect((await page.request.post('/api/v1/public/sales/__mock/template-product-gone', { data: { id: 1 } })).ok()).toBe(true)
  await form.getByTestId('sales-submit').click()
  await expect(form.getByText('المنتج «منتج مؤرشف»')).toBeVisible()
  await expect(page).toHaveURL(/\/sales\/new/)
})

test('the directory pages its templates and the picker reaches one beyond the first page by its name', async ({ page }) => {
  expect((await page.request.post('/api/v1/public/sales/__mock/templates-many', { data: { count: 60 } })).ok()).toBe(true)
  await page.goto(TEMPLATES)
  await expect(links(page)).toHaveCount(50)
  await page.getByTestId('shared-pagination').getByRole('button', { name: /2$/ }).click()
  await expect(page).toHaveURL(/page=2/)
  await expect(links(page)).toHaveCount(13)
  await page.reload()
  await expect(page).toHaveURL(/page=2/)
  await expect(links(page)).toHaveCount(13)

  await page.goto('/sales/new')
  const form = panel(page)
  await form.getByTestId('sales-template-pick').click()
  await page.getByPlaceholder('ابحث بالاسم').last().fill('قالب إضافي 060')
  await page.getByRole('option', { name: 'قالب إضافي 060' }).click()
  await expect(form.getByTestId('sales-template-pick')).toContainText('قالب إضافي 060')
})

test('a non-numeric template id is a not-found state', async ({ page }) => {
  await page.goto(`${TEMPLATES}/abc`)
  await expect(page.getByText('هذا السجل غير متاح').first()).toBeVisible()
  await page.goto(`${TEMPLATES}/abc/edit`)
  await expect(page.getByText('هذا السجل غير متاح').first()).toBeVisible()
})

test('a direct link to a templates page without the settings right is forbidden', async ({ page }) => {
  await useCookie(page, 'mock_caps', 'reader')
  for (const path of [TEMPLATES, `${TEMPLATES}/new`, `${TEMPLATES}/1/edit`]) {
    await page.goto(path)
    await expect(page.getByText('ليس لديك صلاحية').first()).toBeVisible()
  }
  await expect(page.getByTestId('sales-template-name')).toHaveCount(0)
})
