import { expect, test, type Page } from '@playwright/test'

test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Isolated synthetic API only')

const mockOdoo = process.env.NUXT_ODOO_URL ?? `http://127.0.0.1:${process.env.MOCK_PORT ?? 4498}`
type AuditRow = { conversation_id: string; kind: string; result: string; tool_name: string | null; attested: boolean; approved: { id: number } | null }
const allAudit = async (page: Page): Promise<AuditRow[]> => (await (await page.request.get(`${mockOdoo}/__mock/ai-audit`)).json()).items
type UsageRow = { conversation_id: string; kind: string; outcome: string; input_tokens: number | null }
const allUsage = async (page: Page): Promise<UsageRow[]> => (await (await page.request.get(`${mockOdoo}/__mock/ai-usage`)).json()).items
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

test.describe('LiwanOS AI on the mock stack', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test('answers a read question with record cards and audits the message and the read', async ({ page }) => {
    const before = (await allAudit(page)).length
    await ask(page, 'وش مهامي؟')
    await expect(page.getByText('سأقرأ مهامك')).toBeVisible()
    await expect(page.getByText(/عندك \d+ مهمة/)).toBeVisible()
    await expect(page.getByTestId('ai-record').first().getByRole('link')).toBeVisible()
    await expect(page).toHaveURL(/\/ai\?run=r_/)
    expect((await auditSince(page, before)).map(row => [row.kind, row.result, row.tool_name])).toEqual([['message', 'ok', null], ['read', 'ok', 'pmo.list_my_tasks']])
    // The server names a new run itself, so its first message is audited under the run id (never `pending`) and its provider calls are reported under it.
    const runId = runIdOf(page)
    expect(runId).toMatch(/^r_[0-9a-f]{24}$/)
    expect((await auditSince(page, before)).map(row => row.conversation_id)).toEqual([runId, runId])
    expect((await allUsage(page)).filter(row => row.conversation_id === runId).map(row => [row.kind, row.outcome])).toEqual([['plan', 'ok'], ['plan', 'ok'], ['title', 'ok']])
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

  test('lists my conversations, starts a new one and reopens an old one', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await ask(page, 'وش مهامي؟')
    await expect(page.getByText(/عندك \d+ مهمة/)).toBeVisible()
    await expect(page).toHaveURL(/\/ai\?run=r_/)
    const firstRun = runIdOf(page)
    const items = page.getByTestId('ai-run-item')
    const firstItem = page.locator(`[data-testid="ai-run-item"][href="/ai?run=${firstRun}"]`)
    await expect(firstItem).toContainText('ملخص المهام') // named by the service after its first answer
    await expect(firstItem).toHaveAttribute('aria-current', 'page')

    await page.getByTestId('ai-new-run').click()
    await expect(page).toHaveURL(/\/ai$/)
    await expect(page.getByTestId('ai-empty')).toBeVisible()
    await page.getByTestId('ai-composer').fill('أبغى مشروع جديد')
    await page.getByTestId('ai-send').click()
    await expect(page.getByTestId('ai-draft')).toBeVisible()
    await expect(items.first()).toContainText('أبغى مشروع جديد')
    await expect(items.first()).toContainText('بانتظار قرارك')

    await firstItem.click()
    await expect(page).toHaveURL(new RegExp(`/ai\\?run=${firstRun}$`))
    await expect(page.getByText(/عندك \d+ مهمة/)).toBeVisible()
    await expect(page.getByTestId('ai-draft')).toHaveCount(0)
  })

  test('renames a conversation in place, archives it and brings it back', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await ask(page, 'وش مهامي؟')
    await expect(page.getByText(/عندك \d+ مهمة/)).toBeVisible()
    await expect(page).toHaveURL(/\/ai\?run=r_/)
    const runId = runIdOf(page)
    const item = page.locator(`[data-testid="ai-run-item"][href="/ai?run=${runId}"]`)
    const list = page.getByTestId('ai-run-list')

    await list.getByRole('button', { name: /خيارات المحادثة/ }).first().click()
    await page.getByRole('menuitem', { name: 'تغيير الاسم' }).click()
    const input = page.getByTestId('ai-run-rename-input')
    await expect(input).toBeFocused()
    await input.fill('   ')
    await input.press('Enter')
    await expect(page.getByTestId('ai-run-rename-error')).toBeVisible()
    await input.press('Escape')
    await expect(item).toContainText('ملخص المهام')

    await list.getByRole('button', { name: /خيارات المحادثة/ }).first().click()
    await page.getByRole('menuitem', { name: 'تغيير الاسم' }).click()
    await input.fill('مهامي المتأخرة')
    await input.press('Enter')
    await expect(item).toContainText('مهامي المتأخرة')
    await page.reload()
    await expect(item).toContainText('مهامي المتأخرة')

    await list.getByRole('button', { name: /خيارات المحادثة/ }).first().click()
    await page.getByRole('menuitem', { name: 'أرشفة' }).click()
    await expect(item).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`/ai\\?run=${runId}$`)) // the open conversation stays open
    await expect(page.getByText(/عندك \d+ مهمة/)).toBeVisible()

    await page.getByTestId('ai-view-archived').click()
    await expect(item).toContainText('مهامي المتأخرة')
    await list.getByRole('button', { name: /خيارات المحادثة/ }).first().click()
    await page.getByRole('menuitem', { name: 'إلغاء الأرشفة' }).click()
    await expect(page.getByText('لا محادثات مؤرشفة')).toBeVisible()
    await page.getByTestId('ai-view-active').click()
    await expect(item).toContainText('مهامي المتأخرة')
  })

  test('on a phone the conversations sit in an inline disclosure: open, start a new one, reopen an old one', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const noSidewaysScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    const toggle = page.getByTestId('ai-history-toggle')
    const body = page.getByTestId('ai-run-list-body')
    await ask(page, 'وش مهامي؟')
    await expect(page.getByText(/عندك \d+ مهمة/)).toBeVisible()
    await expect(page).toHaveURL(/\/ai\?run=r_/)
    const firstRun = runIdOf(page)

    // Closed by default; the shell sidebar copy of the list is not rendered below 768px.
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(body).toHaveCount(0)
    await expect(page.getByTestId('ai-run-list')).toHaveCount(1)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const firstItem = page.locator(`[data-testid="ai-run-item"][href="/ai?run=${firstRun}"]`)
    await expect(firstItem).toContainText('ملخص المهام')
    await expect(firstItem).toHaveAttribute('aria-current', 'page')
    expect(await noSidewaysScroll()).toBe(true)
    // Touch targets: the toggle, "new", both view buttons, the rows and their menu buttons are at least 44px tall.
    for (const target of [toggle, page.getByTestId('ai-new-run'), page.getByTestId('ai-view-active'), page.getByTestId('ai-view-archived'), firstItem, body.getByRole('button', { name: /خيارات المحادثة/ }).first()]) {
      const box = (await target.boundingBox())!
      expect(box.height, await target.evaluate(el => el.outerHTML.slice(0, 120))).toBeGreaterThanOrEqual(44)
    }
    if (process.env.AI_SHOTS_DIR) await page.screenshot({ path: `${process.env.AI_SHOTS_DIR}/ai-history-375-open.png`, fullPage: true })

    // "New conversation" closes the disclosure and shows the empty thread.
    await page.getByTestId('ai-new-run').click()
    await expect(page).toHaveURL(/\/ai$/)
    await expect(page.getByTestId('ai-empty')).toBeVisible()
    await expect(body).toHaveCount(0)
    await page.getByTestId('ai-composer').fill('أبغى مشروع جديد')
    await page.getByTestId('ai-send').click()
    await expect(page.getByTestId('ai-draft')).toBeVisible()
    await expect(page).toHaveURL(/\/ai\?run=r_/)

    // Picking the old conversation opens it and closes the disclosure; back returns to the other one.
    const secondUrl = page.url()
    await toggle.click()
    await expect(page.getByTestId('ai-run-item').first()).toContainText('أبغى مشروع جديد')
    await firstItem.click()
    await expect(page).toHaveURL(new RegExp(`/ai\\?run=${firstRun}$`))
    await expect(page.getByText(/عندك \d+ مهمة/)).toBeVisible()
    await expect(page.getByTestId('ai-draft')).toHaveCount(0)
    await expect(body).toHaveCount(0)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(await noSidewaysScroll()).toBe(true)
    await page.goBack()
    await expect(page).toHaveURL(secondUrl)
    await expect(page.getByTestId('ai-draft')).toBeVisible()
  })

  test('on a desktop width there is no disclosure and the sidebar list stays', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await ask(page, 'وش مهامي؟')
    await expect(page.getByText(/عندك \d+ مهمة/)).toBeVisible()
    await expect(page.getByTestId('ai-history-toggle')).toHaveCount(0)
    await expect(page.getByTestId('ai-run-item').first()).toBeVisible()
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
    await expect(page.getByTestId('ai-unavailable')).toContainText('LiwanOS AI غير متاح الآن')
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
      await page.context().addCookies([{ name: 'liwan-locale', value: locale, url: new URL(page.url()).origin }])
      await ask(page, 'وش مهامي؟')
      await expect(page.getByText(/عندك \d+ مهمة/)).toBeVisible()
      await expect(page.getByTestId('ai-record').first()).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('lang', locale === 'ar' ? 'ar-SA' : 'en')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      if (process.env.AI_SHOTS_DIR) await page.screenshot({ path: `${process.env.AI_SHOTS_DIR}/ai-${locale}-${name}.png`, fullPage: true })
    })
  }
}
