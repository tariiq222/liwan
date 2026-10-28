import { test, expect, type Page } from '@playwright/test'
import { CrmDashboardSchema, CrmImportBatchListSchema, CrmImportPreviewSchema } from '@webvue/contracts'
import { MOCK_STACK_ONLY } from './support/mock-pages'

// Runs against the isolated synthetic stack (MODULE_UI_PREVIEW=1): the CRM mock keeps state, reset before each test.
test.skip(process.env.E2E_PROJECT_POPUPS !== '1', MOCK_STACK_ONLY)

// Five data rows: three new, one whose phone the mock already holds (row 5) and one that is not a phone number (row 6).
const LEADS_CSV = [
  'الاسم,الهاتف,البريد,ملاحظات',
  'علي المالكي,0541112223,,',
  'منى الغامدي,0542223334,mona@example.com,',
  'ياسر الشريف,0543334445,,',
  'أحمد مكرر,0501234567,,',
  'بلا هاتف صحيح,12,,',
].join('\n')

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

async function upload(page: Page, name = 'leads.csv', content = LEADS_CSV) {
  await page.goto('/crm/imports/new')
  await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(content, 'utf8') })
}

async function choose(page: Page, field: string, option: string) {
  await page.locator(`#import-field-${field}`).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

async function mapStandardColumns(page: Page) {
  await choose(page, 'name', 'الاسم')
  await choose(page, 'phone', 'الهاتف')
  await choose(page, 'email', 'البريد')
  await choose(page, 'source', 'الموقع')
}

test('upload, map, preview the counts, confirm and find the new records', async ({ page }) => {
  await page.goto('/crm/imports')
  await expect(page.locator('main h1')).toHaveText('الاستيراد')
  await page.getByRole('link', { name: 'استيراد ملف' }).click()
  await expect(page).toHaveURL(/\/crm\/imports\/new/)

  await page.locator('input[type=file]').setInputFiles({ name: 'leads.csv', mimeType: 'text/csv', buffer: Buffer.from(LEADS_CSV, 'utf8') })
  await expect(page.getByTestId('crm-import-file-info')).toContainText('leads.csv')
  await expect(page.getByTestId('crm-import-file-info')).toContainText('5')

  await mapStandardColumns(page)
  await page.getByTestId('crm-import-next').click()

  await expect(page.getByTestId('crm-import-count-new')).toContainText('3')
  await expect(page.getByTestId('crm-import-count-duplicate')).toContainText('1')
  await expect(page.getByTestId('crm-import-count-invalid')).toContainText('1')
  await expect(page.getByTestId('crm-import-invalid-rows')).toContainText('الصف 6')
  await expect(page.getByTestId('crm-import-invalid-rows')).toContainText('رقم الهاتف غير صالح')
  await expect(page.getByTestId('crm-import-duplicate-rows')).toContainText('5')
  await expect(page.getByTestId('crm-import-duplicate-rows')).not.toContainText('العتيبي')

  await page.getByTestId('crm-import-confirm').click()
  await expect(page).toHaveURL(/\/crm\/opportunities/)
  await expect(page.getByRole('link', { name: 'علي المالكي' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'منى الغامدي' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'ياسر الشريف' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'أحمد مكرر' })).toHaveCount(0)

  await page.goto('/crm/imports')
  await expect(page.getByTestId('crm-import-batches')).toContainText('leads.csv')
})

test('the mapping needs a name, a phone and a source before it goes on', async ({ page }) => {
  await upload(page)
  await expect(page.getByTestId('crm-import-file-info')).toBeVisible()
  await page.getByTestId('crm-import-next').click()
  await expect(page.getByTestId('crm-import-mapping-error')).toBeVisible()
  await expect(page.getByTestId('crm-import-count-new')).toHaveCount(0)
})

test('a file over 5 MB or of the wrong type is refused before anything is sent', async ({ page }) => {
  await page.goto('/crm/imports/new')
  const input = page.locator('input[type=file]')
  await input.setInputFiles({ name: 'big.csv', mimeType: 'text/csv', buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 97) })
  await expect(page.getByTestId('crm-import-file-error')).toContainText('5')
  await input.setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') })
  await expect(page.getByTestId('crm-import-file-error')).toContainText('CSV')
  await expect(page.getByTestId('crm-import-file-info')).toHaveCount(0)
})

test('a mapping is saved as a profile only when the import is confirmed, then used for the next file', async ({ page }) => {
  await upload(page)
  await mapStandardColumns(page)
  await page.getByLabel('احفظ هذا الربط').check()
  await page.getByLabel('اسم الملف المحفوظ').fill('ملف المعرض')
  await page.getByTestId('crm-import-next').click()
  await expect(page.getByTestId('crm-import-count-new')).toContainText('3')
  const before = await (await page.request.get('/api/v1/crm/import-mappings')).json()
  expect(before.total).toBe(0)

  await page.getByTestId('crm-import-confirm').click()
  await expect(page).toHaveURL(/\/crm\/opportunities/)
  const after = await (await page.request.get('/api/v1/crm/import-mappings')).json()
  expect(after.items.map((item: { name: string }) => item.name)).toEqual(['ملف المعرض'])

  const second = ['الاسم,الهاتف,البريد,ملاحظات', 'سلمى الحربي,0561112223,,', 'نايف القرني,0562223334,,', 'مكرر,0541112223,,'].join('\n')
  await upload(page, 'again.csv', second)
  await page.locator('#import-profile').click()
  await page.getByRole('option', { name: 'ملف المعرض' }).click()
  await expect(page.locator('#import-field-phone')).toContainText('الهاتف')
  await choose(page, 'source', 'معرض')
  await page.getByTestId('crm-import-next').click()
  await expect(page.getByTestId('crm-import-count-new')).toContainText('2')
  await expect(page.getByTestId('crm-import-count-duplicate')).toContainText('1')
})

test('a saved mapping name that is already taken is refused before any record is created', async ({ page }) => {
  const columns = { name: 'الاسم', phone: 'الهاتف' }
  await page.request.post('/api/v1/crm/import-mappings', { data: { name: 'ملف المعرض', columns } })
  await upload(page)
  await mapStandardColumns(page)
  await page.getByLabel('احفظ هذا الربط').check()
  await page.getByLabel('اسم الملف المحفوظ').fill('ملف المعرض')
  await page.getByTestId('crm-import-next').click()
  await page.getByTestId('crm-import-confirm').click()
  await expect(page.getByTestId('crm-import-confirm-error')).toContainText('يوجد ملف محفوظ بهذا الاسم')
  const batches = await (await page.request.get('/api/v1/crm/imports')).json()
  expect(batches.total).toBe(0)
})

test('the agent is asked for only when distribution is on import', async ({ page }) => {
  await upload(page)
  await expect(page.getByTestId('crm-import-file-info')).toBeVisible()
  await expect(page.locator('#import-agent')).toHaveCount(0)

  const patch = await page.request.get('/api/v1/crm/settings')
  const { revision } = await patch.json()
  const saved = await page.request.patch('/api/v1/crm/settings', { data: { revision, values: { distribution_mode: 'on_import' } } })
  expect(saved.ok()).toBe(true)

  await upload(page)
  await mapStandardColumns(page)
  await page.getByTestId('crm-import-next').click()
  await expect(page.getByTestId('crm-import-mapping-error')).toContainText('المسؤول')
  await expect(page.getByTestId('crm-import-count-new')).toHaveCount(0)
})

test('the dashboard shows the calls due now with a phone link and the manager figures', async ({ page }) => {
  await page.goto('/crm')
  await expect(page.locator('main h1')).toHaveText('لوحة المتابعة')
  const tile = (strip: string, label: string) => page.getByTestId(strip).getByTestId('metric-tile').filter({ hasText: label })
  await expect(tile('crm-agent-kpis', 'اتصالات مستحقة الآن')).toContainText('1')
  const due = page.getByTestId('crm-due-list')
  await expect(due.getByRole('link', { name: 'أحمد العتيبي', exact: true })).toBeVisible()
  await expect(due.getByTestId('crm-due-phone')).toHaveAttribute('href', 'tel:0501234567')

  await expect(tile('crm-manager-kpis', 'بلا مسؤول')).toContainText('1')
  await expect(tile('crm-manager-kpis', 'تحتاج قرار المدير')).toContainText('1')
  await expect(tile('crm-manager-kpis', 'مبيعات هذا الشهر')).toContainText('108')
  await expect(page.getByTestId('crm-conversion')).toContainText('هذا الشهر')
  await expect(page.getByTestId('crm-conversion')).toContainText('الموقع')
  await expect(page.getByTestId('crm-agent-table')).toContainText('ليلى الحربي')
})

test('the answers of the mock follow the contracts', async ({ page }) => {
  const dashboard = await page.request.get('/api/v1/crm/dashboard')
  expect(CrmDashboardSchema.safeParse(await dashboard.json()).success).toBe(true)

  const body = { file_name: 'leads.csv', content_base64: Buffer.from(LEADS_CSV, 'utf8').toString('base64'), mapping: { name: 'الاسم', phone: 'الهاتف' }, source_id: 1 }
  const preview = await page.request.post('/api/v1/crm/imports/preview', { data: body })
  expect(CrmImportPreviewSchema.parse(await preview.json())).toMatchObject({ new: 3, duplicate: 1, invalid: 1 })
  const created = await page.request.post('/api/v1/crm/imports', { data: body })
  expect(created.ok()).toBe(true)
  const batches = await page.request.get('/api/v1/crm/imports')
  expect(CrmImportBatchListSchema.parse(await batches.json()).items[0]).toMatchObject({ created: 3, duplicate: 1, invalid: 1 })
})
