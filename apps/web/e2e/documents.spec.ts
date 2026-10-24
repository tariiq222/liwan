import { test as base, expect, type Page, type BrowserContext } from '@playwright/test'
import { DocumentDetailSchema, DocumentListSchema } from '@webvue/contracts'

// One serial customer browser keeps its normal HTTP asset cache across journeys.
// Fresh pages still isolate drafts; the real edge rate limits remain unchanged.
const test = base.extend<{}, { documentContext: BrowserContext }>({
  documentContext: [async ({ browser }, use) => {
    const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', locale: 'ar-SA' })
    await login(context)
    await use(context); await context.close()
  }, { scope: 'worker' }],
  page: async ({ documentContext }, use) => {
    const page = await documentContext.newPage()
    await use(page); await page.close()
  },
})

async function login(page: Page | BrowserContext) {
  const response = await page.request.post('/api/auth/login', { data: { login: process.env.E2E_ADMIN_LOGIN ?? 'admin', password: process.env.E2E_ADMIN_PASSWORD ?? 'admin' } })
  expect(response.ok()).toBe(true)
}
async function create(page: Page, suffix = '') {
  const response = await page.request.post('/api/v1/documents', { data: { name: `Document acceptance ${Date.now()} ${suffix}`, body: '<p>Original content</p>' } })
  expect(response.status()).toBe(201)
  return DocumentDetailSchema.parse(await response.json())
}
async function open(page: Page, url: string) {
  await page.goto(url)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
}
const saveButton = (page: Page) => page.getByRole('button', { name: 'حفظ', exact: true })

async function fileAction(page: Page, label: string) {
  const menu = page.getByRole('button', { name: 'إجراءات boundary.txt', exact: true })
  if (await menu.count()) { await menu.click(); await page.getByRole('menuitem', { name: label, exact: true }).click() }
  else await page.getByRole('button', { name: label, exact: true }).click()
}


test('creates a restricted document, refreshes its canonical record and returns to filtered list', async ({ page }) => {
  const suffix = String(Date.now()), origin = `/documents?q=${suffix}#list`
  await open(page, origin)
  await page.getByTestId('document-new').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText('المستندات الجديدة مقيّدة افتراضيًا')).toBeVisible()
  await page.getByLabel('العنوان').fill(`Acceptance ${suffix}`)
  await page.getByRole('textbox', { name: 'المحتوى' }).fill('Created through the customer UI')
  const response = page.waitForResponse(response => response.url().endsWith('/api/v1/documents') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'إنشاء', exact: true }).click()
  const document = DocumentDetailSchema.parse(await (await response).json())
  expect(document.visibility).toBe('restricted')
  await expect(page).toHaveURL(new RegExp(`/documents/${document.id}\\?`))
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: document.name })).toBeVisible()
  await page.getByRole('link', { name: 'رجوع', exact: true }).click()
  await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash).toBe(origin)
  DocumentListSchema.parse(await (await page.request.get(`/api/v1/documents?q=${suffix}`)).json())
})

test('old direct links redirect before HR gates and preserve record id, filters and fragment', async ({ page }) => {
  const document = await create(page)
  await open(page, `/hr/departments/1/documents/${document.id}?returnTo=${encodeURIComponent('/hr/documents?q=policy&offset=25#list')}#files`)
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/documents/${document.id}`)
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/documents?q=policy&offset=25#list')
  expect(new URL(page.url()).hash).toBe('#files')
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: document.name })).toBeVisible()
})

test('a stale editor keeps its local draft until explicit reload', async ({ page }) => {
  const document = await create(page)
  await open(page, `/documents/${document.id}/edit`)
  const name = page.getByLabel('العنوان')
  await expect(name).toBeEnabled(); await name.fill('Local unsaved title')
  const content = page.getByRole('textbox', { name: 'المحتوى', exact: true }); await content.fill('Local unsaved content')
  const changed = await page.request.patch(`/api/v1/documents/${document.id}`, { data: { expected_revision: document.revision, name: 'Saved in another tab', body: '<p>Content from another tab</p>' } })
  expect(changed.status()).toBe(200)
  const conflict = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith(`/api/v1/documents/${document.id}`))
  await saveButton(page).click(); expect((await conflict).status()).toBe(409)
  await expect(name).toHaveValue('Local unsaved title'); await expect(content).toHaveText('Local unsaved content')
  await expect(page.getByText('تغيّر هذا المستند في جلسة أخرى')).toBeVisible()
  await page.getByRole('button', { name: 'تجاهل المسودة وأعد التحميل' }).click()
  await expect(name).toHaveValue('Saved in another tab'); await expect(content).toHaveText('Content from another tab')
})

test('file actions are saved on the read page; accepts 10 MiB and rejects a larger upload', async ({ page }) => {
  const document = await create(page)
  await open(page, `/documents/${document.id}`)
  const input = page.locator('input[type=file]')
  await expect(input).toBeEnabled()
  const response = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/api/v1/documents/${document.id}/files`))
  await input.setInputFiles({ name: 'boundary.txt', mimeType: 'text/plain', buffer: Buffer.alloc(10 * 1024 * 1024, 97) })
  expect((await response).status()).toBe(200)
  await expect(page.getByRole('link', { name: 'تنزيل boundary.txt', exact: true })).toBeVisible()
  await input.setInputFiles({ name: 'over-limit.txt', mimeType: 'text/plain', buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 97) })
  await expect(page.getByText('يتجاوز حجم الملف 10 ميبيبايت.')).toBeVisible()
  const latest = DocumentDetailSchema.parse(await (await page.request.get(`/api/v1/documents/${document.id}`)).json())
  const files = await (await page.request.get(`/api/v1/documents/${document.id}/files`)).json()
  expect(files.items.map((file: { name: string }) => file.name)).toEqual(['boundary.txt'])
  const bytes = await page.request.get(files.items[0]!.download_url)
  expect(bytes.status()).toBe(200); expect((await bytes.body()).length).toBe(10 * 1024 * 1024)
  await fileAction(page, 'قفل')
  await expect(page.getByText('مقفل', { exact: true })).toBeVisible()
  await fileAction(page, 'إلغاء القفل')
  await expect(page.getByText('مقفل', { exact: true })).toHaveCount(0)
  await fileAction(page, 'أرشفة')
  await page.getByRole('button', { name: 'تأكيد الأرشفة', exact: true }).click()
  await expect(page.getByRole('button', { name: 'استعادة', exact: true })).toBeVisible()
  await fileAction(page, 'استعادة')
  await page.reload(); await expect(page.getByRole('link', { name: 'تنزيل boundary.txt', exact: true })).toBeVisible()
})

test('access is an independent page with reader/editor grants and last-editor protection', async ({ page }) => {
  const document = await create(page)
  await open(page, `/documents/${document.id}/access`)
  await expect(page.getByRole('heading', { level: 1, name: 'إدارة الوصول' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const remove = page.getByRole('button', { name: /^إزالة وصول/ })
  await expect(remove).toHaveCount(1); await expect(remove).toBeDisabled()
  await expect(page.getByText('أبقِ محرّرًا واحدًا على الأقل يملك صلاحية إدارة المستندات.')).toBeVisible()
})

for (const locale of ['ar', 'en']) for (const mode of ['light', 'dark']) for (const width of [390, 768, 1440]) {
  test(`library ${locale} ${mode} ${width} has one heading and no document overflow`, async ({ page }, testInfo) => {
    expect((await page.request.patch('/api/v1/me/appearance', { data: { mode } })).status()).toBe(200)
    await page.setViewportSize({ width, height: 900 })
    await open(page, '/documents')
    await page.evaluate(async language => { await (window as any).useNuxtApp().$i18n.setLocale(language) }, locale)
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
    await expect.poll(() => page.locator('html').evaluate(element => element.classList.contains('dark'))).toBe(mode === 'dark')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (width >= 768) await expect.poll(() => page.evaluate(() => {
      const main = document.querySelector('[data-testid="shell-main"]')!.getBoundingClientRect()
      const sidebar = document.querySelector('[data-testid="application-navigation"]')!.getBoundingClientRect()
      return document.documentElement.dir === 'rtl' ? main.right <= sidebar.left : main.left >= sidebar.right
    })).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`documents-library-${locale}-${mode}-${width}.png`), fullPage: true, animations: 'disabled' })
  })
}
