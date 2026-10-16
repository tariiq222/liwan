import { expect, test, type Page } from '@playwright/test'

test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Isolated synthetic API only')

const mockOdoo = process.env.NUXT_ODOO_URL ?? `http://127.0.0.1:${process.env.MOCK_PORT ?? 4498}`
type AuditRow = { conversation_id: string; kind: string; result: string; tool_name: string | null; attested: boolean; approved: { id: number } | null }
const allAudit = async (page: Page): Promise<AuditRow[]> => (await (await page.request.get(`${mockOdoo}/__mock/ai-audit`)).json()).items
// The first message of a run is audited before the service names the run, so its row carries `pending`, not the run id.
const auditSince = async (page: Page, before: number) => (await allAudit(page)).slice(before)
const runIdOf = (page: Page) => new URL(page.url()).searchParams.get('run')!

async function login(page: Page) {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function ask(page: Page, text: string) {
  await page.goto('/ai')
  await expect(page.getByTestId('ai-empty')).toBeVisible()
  await page.getByTestId('ai-composer').fill(text)
  await expect(page.getByTestId('ai-send')).toBeEnabled()
  await page.getByTestId('ai-send').click()
}

test.describe('Nasq AI on the mock stack', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test('answers a read question with record cards and audits the message and the read', async ({ page }) => {
    const before = (await allAudit(page)).length
    await ask(page, 'وش مهامي؟')
    await expect(page.getByText('سأقرأ مهامك')).toBeVisible()
    await expect(page.getByText(/عندك \d+ مهمة/)).toBeVisible()
    await expect(page.getByTestId('ai-record').first().getByRole('link')).toBeVisible()
    await expect(page).toHaveURL(/\/ai\?run=r_/)
    expect((await auditSince(page, before)).map(row => [row.kind, row.result, row.tool_name])).toEqual([['message', 'ok', null], ['read', 'ok', 'pmo.list_my_tasks']])
  })

  test('a project request opens the real create page prefilled and needs the attestation', async ({ page }) => {
    const before = (await allAudit(page)).length
    await ask(page, 'سوّ لي مشروع للبوابة')
    await expect(page.getByTestId('ai-draft')).toContainText('سأجهّز مسودة مشروع')
    // The page adds ?run= to the URL once the stream has ended: wait for it before reading the id.
    await expect(page).toHaveURL(/\/ai\?run=r_/)
    const runId = runIdOf(page)
    await page.getByTestId('ai-draft-open').click()
    await expect(page).toHaveURL(/\/projects\/new\?aiDraft=/)
    await expect(page.getByTestId('project-create-ai-badge')).toBeVisible()
    await expect(page.getByTestId('project-create-name')).toHaveValue('بوابة إرادة')
    for (let step = 0; step < 10 && await page.getByTestId('charter-step-next').isVisible(); step++) await page.getByTestId('charter-step-next').click()
    await expect(page.getByTestId('project-create-submit')).toBeDisabled()
    await page.getByTestId('project-create-attest').getByRole('checkbox').check()
    await expect(page.getByTestId('project-create-submit')).toBeEnabled()
    await page.getByTestId('project-create-submit').click()
    // `/ai` strips `resume` and `created` from the address as soon as it has read them.
    await expect(page.getByText('أُنشئ المشروع بعد اعتمادك')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/ai\\?run=${runId}$`))
    const created = (await auditSince(page, before)).at(-1)!.approved!.id
    expect(created).toBeGreaterThan(0)
    await expect(page.getByTestId('ai-record').getByRole('link', { name: 'بوابة إرادة' })).toHaveAttribute('href', `/projects/${created}`)
    expect((await auditSince(page, before)).map(row => [row.kind, row.result])).toEqual([['message', 'ok'], ['draft', 'proposed'], ['draft', 'approved']])
    expect((await auditSince(page, before)).at(-1)).toMatchObject({ conversation_id: runId, attested: true, approved: { id: created } })
  })

  test('a refresh on a waiting run shows the pending draft and discarding sends one rejection', async ({ page }) => {
    await ask(page, 'أبغى مشروع جديد')
    await expect(page.getByTestId('ai-draft-open')).toBeVisible()
    await expect(page).toHaveURL(/\/ai\?run=r_/)
    await page.reload()
    await expect(page.getByTestId('ai-draft-open')).toBeVisible()
    const resumes: unknown[] = []
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/resume')) resumes.push(request.postDataJSON()) })
    await page.getByTestId('ai-draft-discard').click()
    await expect(page.getByText('ألغيت المسودة')).toBeVisible()
    expect(resumes).toHaveLength(1)
    expect(resumes[0]).toMatchObject({ decision: 'rejected' })
  })

  test('a reader never gets the draft tool and the assistant answers in plain text', async ({ page }) => {
    await page.context().addCookies([{ name: 'mock_caps', value: 'reader', url: new URL(page.url()).origin }])
    const before = (await allAudit(page)).length
    await ask(page, 'سوّ لي مشروع للبوابة')
    await expect(page.getByText(/لا أملك أداة لتجهيز مسودة مشروع/)).toBeVisible()
    await expect(page.getByTestId('ai-draft')).toHaveCount(0)
    expect((await auditSince(page, before)).map(row => row.kind)).toEqual(['message'])
  })

  test('shows the unavailable state when the server answers 503 ai_unavailable', async ({ page }) => {
    await page.route('**/api/ai/runs', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ data: { code: 'ai_unavailable', message: 'down' } }) }))
    await ask(page, 'وش مهامي؟')
    await expect(page.getByTestId('ai-unavailable')).toContainText('Nasq AI غير متاح الآن')
    await expect(page.getByTestId('ai-composer')).toHaveCount(0)
  })
})

// Arabic and English, desktop and mobile width, light theme: no sideways scroll; screenshots when AI_SHOTS_DIR is set.
for (const locale of ['ar', 'en'] as const) {
  for (const [name, size] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 844 }]] as const) {
    test(`the /ai page fits ${name} width in ${locale}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'light' })
      await page.setViewportSize(size)
      await login(page)
      await page.context().addCookies([{ name: 'nasq-locale', value: locale, url: new URL(page.url()).origin }])
      await ask(page, 'وش مهامي؟')
      await expect(page.getByText(/عندك \d+ مهمة/)).toBeVisible()
      await expect(page.getByTestId('ai-record').first()).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('lang', locale === 'ar' ? 'ar-SA' : 'en')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      if (process.env.AI_SHOTS_DIR) await page.screenshot({ path: `${process.env.AI_SHOTS_DIR}/ai-${locale}-${name}.png`, fullPage: true })
    })
  }
}
