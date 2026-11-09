import { expect, test, type Page } from '@playwright/test'
import { FinanceEntrySchema, FinanceEntryListSchema, FinanceSummarySchema, ProjectDashboardAnalyticsSchema } from '@liwan/contracts'
import { ACCEPTANCE_ORIGIN, signIn } from './support/realOdooSession'

// Needs a real Odoo: it logs in and writes data, which the mock answers with 404.
// Runs only on the isolated real-Odoo stack (deploy/ci/e2e-odoo.sh).
test.skip(process.env.E2E_REAL_ODOO !== '1', 'Explicit isolated real Odoo acceptance only')

test.beforeEach(async ({}, info) => { expect(new URL(String(info.project.use.baseURL)).origin).toBe(ACCEPTANCE_ORIGIN) })

// The project detail a create or a tool write answers: its own write token and its effective tool state.
type ProjectWithTools = {
  id: number
  name: string
  updated_at: string
  tools: { finance: { policy: string, enabled: boolean } }
}

// Every project of this file is created with an end date, because the create policy requires one.
async function createProject(page: Page, suffix: string): Promise<ProjectWithTools> {
  const response = await page.request.post('/api/v1/projects', { data: { name: `Phase2 ${suffix} ${Date.now()}`, date_end: '2035-12-31' } })
  expect(response.status(), await response.text()).toBe(201)
  return response.json() as Promise<ProjectWithTools>
}

/**
 * Finance is an optional project tool and off by default (`finance_tool_policy` is `optional` in
 * `liwan_pmo/models/liwan_settings.py`, and `liwan_finance_enabled` defaults to false). Until the project turns it
 * on, every finance route answers 403 "This project tool is not enabled." (`project_tools.py:_liwan_check_tool`).
 * A customer opts in with the project's own revision token, which is exactly what this does; the helper pins both
 * halves — the default is off, and the tool reads back on after the preference.
 */
async function enableFinance(page: Page, project: ProjectWithTools): Promise<ProjectWithTools> {
  expect(project.tools.finance, 'finance is optional and off by default').toMatchObject({ policy: 'optional', enabled: false })
  const response = await page.request.patch(`/api/v1/projects/${project.id}`, {
    data: { expected_updated_at: project.updated_at, tool_preferences: { finance: true } },
  })
  expect(response.status(), await response.text()).toBe(200)
  const detail = await response.json() as ProjectWithTools
  expect(detail.tools.finance.enabled, 'the project tool reads back on').toBe(true)
  return detail
}

async function projectWithFinance(page: Page, suffix: string): Promise<ProjectWithTools> {
  return enableFinance(page, await createProject(page, suffix))
}

const financePath = (project: { id: number }) => `/api/v1/projects/${project.id}/finance`

async function financeSummary(page: Page, project: { id: number }) {
  return FinanceSummarySchema.parse(await (await page.request.get(`${financePath(project)}/summary`)).json())
}

test('budget ledger: an unknown budget, stale revisions and the report totals', async ({ page }) => {
  await signIn(page, 'pmo_manager')
  const created = await createProject(page, 'ledger')
  const off = await page.request.get(`${financePath(created)}/summary`)
  expect(off.status(), 'a project opts into finance before its ledger answers').toBe(403)
  expect(await off.json()).toMatchObject({ code: 'forbidden' })
  const project = await enableFinance(page, created)
  const path = financePath(project)

  // A fresh project with the tool on: no charter estimate and no budget entered yet, and an actual that no longer
  // comes from manual entries.
  const before = await financeSummary(page, project)
  expect(before).toMatchObject({
    project_id: project.id,
    charter_estimate: null,
    planned: null,
    actual: 0,
    remaining: null,
    utilization_percent: null,
    over_budget: false,
    budget_count: 0,
    expense_count: 0,
    actual_source: 'external',
  })

  const budgetResult = await page.request.post(path, { data: { kind: 'budget', title: 'Infrastructure', amount: 1000 } })
  expect(budgetResult.status()).toBe(201)
  const budget = FinanceEntrySchema.parse(await budgetResult.json())
  expect(budget).toMatchObject({
    project_id: project.id, kind: 'budget', title: 'Infrastructure', amount: 1000,
    expense_date: null, budget_entry_id: null, reference: '', notes: '',
  })

  const filtered = FinanceEntryListSchema.parse(await (await page.request.get(`${path}?kind=budget&q=nothing`)).json())
  expect(filtered.items).toEqual([])
  expect(filtered.total).toBe(0)
  expect(filtered.can_manage).toBe(true)
  expect(filtered.summary).toMatchObject({
    planned: 1000, actual: 0, remaining: 1000, utilization_percent: 0, over_budget: false, budget_count: 1, expense_count: 0,
  })

  const edit = await page.request.patch(`${path}/${budget.id}`, { data: { amount: 1200, expected_updated_at: budget.updated_at } })
  expect(edit.status()).toBe(200)
  const updated = FinanceEntrySchema.parse(await edit.json())
  expect(updated.amount).toBe(1200)
  expect(updated.updated_at).not.toBe(budget.updated_at)

  // The revision the caller opened is spent by the edit above: both write kinds answer 409 until it refreshes.
  const staleDelete = await page.request.delete(`${path}/${budget.id}`, { data: { expected_updated_at: budget.updated_at } })
  expect(staleDelete.status()).toBe(409)
  expect(await staleDelete.json()).toMatchObject({ code: 'stale_write', field: 'expected_updated_at' })
  const stalePatch = await page.request.patch(`${path}/${budget.id}`, { data: { amount: 500, expected_updated_at: budget.updated_at } })
  expect(stalePatch.status()).toBe(409)

  // The dashboard reads the same summary, so its row and its currency totals agree with the ledger.
  const reports = ProjectDashboardAnalyticsSchema.parse(await (await page.request.get(`/api/v1/reports/projects/analytics?q=${encodeURIComponent(project.name)}`)).json())
  expect(reports.project_count).toBe(1)
  expect(reports.projects).toHaveLength(1)
  expect(reports.projects[0]?.finance).toMatchObject({ planned: 1200, actual: 0, remaining: 1200, over_budget: false, budget_count: 1 })
  expect(reports.totals).toHaveLength(1)
  expect(reports.totals[0]).toMatchObject({
    project_count: 1, budgeted_project_count: 1, planned: 1200, actual: 0, remaining: 1200, over_budget_count: 0,
  })

  expect((await page.request.delete(`${path}/${budget.id}`, { data: { expected_updated_at: updated.updated_at } })).status()).toBe(200)
  const after = await financeSummary(page, project)
  expect(after).toMatchObject({ planned: null, actual: 0, remaining: null, budget_count: 0 })
})

test('a zero budget is within budget and malformed amounts never write', async ({ page }) => {
  await signIn(page, 'pmo_manager')
  const project = await projectWithFinance(page, 'zero')
  const path = financePath(project)
  for (const amount of [true, -1, 1.001, 'NaN']) {
    expect((await page.request.post(path, { data: { kind: 'budget', title: 'Invalid', amount } })).status()).toBe(422)
  }
  expect((await page.request.post(path, { data: { kind: 'budget', title: 'Zero', amount: 0 } })).status()).toBe(201)
  const summary = await financeSummary(page, project)
  // A planned 0 is a plan of nothing, not an overrun: nothing can exceed it while the actual is 0, and a zero
  // denominator has no utilization.
  expect(summary).toMatchObject({ planned: 0, actual: 0, remaining: 0, over_budget: false, utilization_percent: null, budget_count: 1, expense_count: 0 })
})

test("a project's actual comes from its cost center, so a manual expense is refused", async ({ page }) => {
  await signIn(page, 'pmo_manager')
  const project = await projectWithFinance(page, 'actual-source')
  const path = financePath(project)

  // With the finance application installed every project's actual is external (liwan_pmo_finance asks
  // `finance.enabled`), and linking the cost center needs `finance.analytic.manage`, which a project manager does not
  // hold. The cost center itself is a tenant setting (`liwan_pmo_finance_cost_center_mode`, default manual), so this
  // pins the capability answers and the source, not whether an account happens to be linked.
  const before = await financeSummary(page, project)
  expect(before).toMatchObject({
    actual_source: 'external',
    actual: 0,
    expense_count: 0,
    can_read_actual_lines: false,
    can_choose_actual_account: false,
  })

  // The capability that used to be tested here — enter an expense and watch the actual move — is gone: the ledger
  // records the plan only, and the actual is the posted expense of the project's cost center.
  const refused = await page.request.post(path, { data: { kind: 'expense', title: 'Hosting invoice', amount: 250, expense_date: '2026-09-07' } })
  expect(refused.status()).toBe(422)
  expect(await refused.json()).toMatchObject({ code: 'invalid', message: 'تُسجَّل المصروفات في مركز تكلفة المشروع وليس هنا.' })

  // The ledger holds the budget rows of an external project: asking for expenses is an empty page, not an error.
  const expenses = FinanceEntryListSchema.parse(await (await page.request.get(`${path}?kind=expense`)).json())
  expect(expenses.items).toEqual([])
  expect(expenses.total).toBe(0)

  // A reader without any finance.analytic capability may read the ledger and neither the lines nor the link.
  await signIn(page, 'finance_reader')
  const read = FinanceEntryListSchema.parse(await (await page.request.get(path)).json())
  expect(read.can_manage).toBe(false)
  expect(read.summary).toMatchObject({ actual_source: 'external', can_read_actual_lines: false, can_choose_actual_account: false })
})

test('a project reader inspects the ledger but cannot change an entry; no roles is refused', async ({ page }) => {
  await signIn(page, 'pmo_manager')
  const project = await projectWithFinance(page, 'permissions')
  const path = financePath(project)
  const created = await page.request.post(path, { data: { kind: 'budget', title: 'Protected', amount: 100 } })
  expect(created.status()).toBe(201)
  const entry = FinanceEntrySchema.parse(await created.json())
  await signIn(page, 'finance_reader')
  const result = await page.request.get(path)
  expect(result.status()).toBe(200)
  const ledger = FinanceEntryListSchema.parse(await result.json())
  expect(ledger.can_manage).toBe(false)
  expect(ledger.summary.planned).toBe(100)
  expect((await page.request.post(path, { data: { kind: 'budget', title: 'Denied', amount: 1 } })).status()).toBe(403)
  expect((await page.request.patch(`${path}/${entry.id}`, { data: { amount: 2, expected_updated_at: entry.updated_at } })).status()).toBe(403)
  expect((await page.request.delete(`${path}/${entry.id}`, { data: { expected_updated_at: entry.updated_at } })).status()).toBe(403)
  await page.goto(`/projects/${project.id}/finance`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByTestId('project-finance-summary')).toContainText('100.00')
  await expect(page.locator(`a[href*="/finance/new"]`)).toHaveCount(0)
  await page.goto(`/projects/${project.id}/finance/${entry.id}/edit`)
  await expect(page.getByTestId('finance-form')).toHaveCount(0)
  await expect(page.getByText('لا تملك صلاحية إدارة هذا المشروع', { exact: false })).toBeVisible()
  await signIn(page, 'no_roles')
  expect((await page.request.get(path)).status()).toBe(403)
  expect((await page.request.get('/api/v1/reports/projects/analytics')).status()).toBe(403)
})

test('concurrent edits using the same revision allow exactly one writer', async ({ page }) => {
  await signIn(page, 'pmo_manager')
  const project = await projectWithFinance(page, 'concurrent')
  const path = financePath(project)
  const created = await page.request.post(path, { data: { kind: 'budget', title: 'Concurrency', amount: 100 } })
  expect(created.status()).toBe(201)
  const entry = FinanceEntrySchema.parse(await created.json())
  const responses = await Promise.all([110, 120].map(amount => page.request.patch(`${path}/${entry.id}`, { data: { amount, expected_updated_at: entry.updated_at } })))
  expect(responses.map(response => response.status()).sort()).toEqual([200, 409])
  const success = responses.find(response => response.status() === 200)!
  const winner = FinanceEntrySchema.parse(await success.json())
  const current = FinanceEntrySchema.parse(await (await page.request.get(`${path}/${entry.id}`)).json())
  expect(current).toEqual(winner)
  const summary = await financeSummary(page, project)
  expect(summary.planned).toBe(winner.amount)
  expect(summary.budget_count).toBe(1)
})

test('budget amounts are summed exactly at currency precision, so 0.1 plus 0.2 is 0.3', async ({ page }) => {
  await signIn(page, 'pmo_manager')
  const project = await projectWithFinance(page, 'precision')
  const path = financePath(project)
  for (const [title, amount] of [['Materials', 0.1], ['Labour', 0.2]] as const) {
    expect((await page.request.post(path, { data: { kind: 'budget', title, amount } })).status()).toBe(201)
  }
  const summary = await financeSummary(page, project)
  // A float sum would report 0.30000000000000004 here and would flip a comparison against an exact 0.3.
  expect(summary).toMatchObject({ planned: 0.3, actual: 0, remaining: 0.3, over_budget: false, utilization_percent: 0, budget_count: 2 })
})

test('budget pages create, refresh, edit and return to the filtered ledger', async ({ page }) => {
  await signIn(page, 'pmo_manager')
  const project = await projectWithFinance(page, 'pages')
  const ledger = `/projects/${project.id}/finance?kind=budget&q=UI-budget`
  await page.goto(`/projects/${project.id}/finance/new?kind=budget&returnTo=${encodeURIComponent(ledger)}`)
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'قيد مالي جديد' })).toBeVisible()
  const form = page.getByTestId('finance-form')
  await expect(form.locator('#finance-title')).toBeEnabled()
  await form.locator('#finance-title').fill('UI-budget provision')
  await form.locator('#finance-amount').fill('1000')
  const createdResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/projects/${project.id}/finance` && response.request().method() === 'POST')
  await page.getByRole('dialog').getByRole('button', { name: 'إنشاء', exact: true }).click()
  const created = await createdResponse
  expect(created.status()).toBe(201)
  const entry = FinanceEntrySchema.parse(await created.json())
  // Creating opens the record, and the record keeps the filtered ledger as its way back.
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/projects/${project.id}/finance/${entry.id}`)
  await expect(page.getByTestId('finance-entry-detail')).toContainText('1000.00')
  await page.reload()
  await expect(page.getByTestId('finance-entry-detail')).toContainText('1000.00')
  await page.getByRole('link', { name: 'تعديل', exact: true }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/projects/${project.id}/finance/${entry.id}/edit`)
  await expect(form.locator('#finance-title')).toHaveValue('UI-budget provision')
  await form.locator('#finance-amount').fill('1200')
  const savedResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/projects/${project.id}/finance/${entry.id}` && response.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'حفظ', exact: true }).click()
  expect((await savedResponse).status()).toBe(200)
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/projects/${project.id}/finance/${entry.id}`)
  await expect(page.getByTestId('finance-entry-detail')).toContainText('1200.00')
  await page.getByRole('link', { name: 'العودة إلى المالية', exact: true }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/projects/${project.id}/finance`)
  const returned = new URL(page.url()).searchParams
  expect(returned.get('kind')).toBe('budget')
  expect(returned.get('q')).toBe('UI-budget')
  await expect(page.getByTestId('finance-entry-row')).toHaveCount(1)
  await expect(page.getByTestId('project-finance-summary')).toContainText('1200.00')
  // `/reports` is retired (nuxt.config.ts 301s it to /projects/dashboard) and `reports-row` / `reports-totals` no
  // longer exist, so the former report half of this journey is dropped: the ledger's totals are pinned by the
  // analytics contract in the first test, and the dashboard by the phone journey below.
})

test('a budget row deletes with the inline confirmation on its record page', async ({ page }) => {
  await signIn(page, 'pmo_manager')
  const project = await projectWithFinance(page, 'delete-ui')
  const path = financePath(project)
  const created = await page.request.post(path, { data: { kind: 'budget', title: 'UI budget to delete', amount: 1000 } })
  expect(created.status()).toBe(201)
  const entry = FinanceEntrySchema.parse(await created.json())
  await page.goto(`/projects/${project.id}/finance/${entry.id}`)
  const detail = page.getByTestId('finance-entry-detail')
  await expect(detail).toBeVisible()
  // Deletion is the destructive entry of the row-actions menu, never a bare button, and it confirms inline.
  await expect(detail.getByRole('button', { name: 'حذف', exact: true })).toHaveCount(0)
  await page.getByTestId('row-actions-menu').click()
  await page.getByRole('menuitem', { name: 'حذف', exact: true }).click()
  const confirmation = page.getByTestId('finance-delete-confirm')
  await expect(confirmation).toBeVisible()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await confirmation.getByRole('button', { name: 'حذف', exact: true }).click()
  await expect(page.getByTestId('project-finance-page')).toBeVisible()
  const summary = await financeSummary(page, project)
  expect(summary).toMatchObject({ planned: null, actual: 0, remaining: null, budget_count: 0, expense_count: 0 })
})

test('an unsaved finance draft survives staying on the form', async ({ page }) => {
  await signIn(page, 'pmo_manager')
  const project = await projectWithFinance(page, 'draft')
  await page.goto(`/projects/${project.id}/finance/new?kind=budget`)
  await expect(page.getByRole('dialog')).toBeVisible()
  const form = page.getByTestId('finance-form')
  await expect(form.locator('#finance-title')).toBeEnabled()
  await form.locator('#finance-title').fill('مسودة الميزانية')
  await page.getByRole('button', { name: 'إلغاء', exact: true }).click()
  const dialog = page.getByTestId('unsaved-changes-dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'البقاء في الصفحة' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(form.locator('#finance-title')).toHaveValue('مسودة الميزانية')
  expect(new URL(page.url()).pathname).toBe(`/projects/${project.id}/finance/new`)
})

test('a real stale edit preserves the draft and blocks ordinary save', async ({ page }) => {
  await signIn(page, 'pmo_manager')
  const project = await projectWithFinance(page, 'stale-ui')
  const path = financePath(project)
  const created = await page.request.post(path, { data: { kind: 'budget', title: 'Stale UI budget', amount: 100 } })
  expect(created.status()).toBe(201)
  const entry = FinanceEntrySchema.parse(await created.json())
  await page.goto(`/projects/${project.id}/finance/${entry.id}/edit`)
  const form = page.getByTestId('finance-form')
  await expect(form.locator('#finance-amount')).toBeEnabled()
  await form.locator('#finance-amount').fill('200')
  expect((await page.request.patch(`${path}/${entry.id}`, { data: { amount: 150, expected_updated_at: entry.updated_at } })).status()).toBe(200)
  await page.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page.getByTestId('finance-stale')).toBeVisible()
  await expect(form.locator('#finance-amount')).toHaveValue('200')
  await expect(page.getByRole('button', { name: 'حفظ', exact: true })).toBeDisabled()
  expect((await (await page.request.get(`${path}/${entry.id}`)).json()).amount).toBe(150)
})

test('a failed stale refresh leaves the editable draft mounted', async ({ page }) => {
  await signIn(page, 'pmo_manager')
  const project = await projectWithFinance(page, 'refresh-error')
  const path = financePath(project)
  const created = await page.request.post(path, { data: { kind: 'budget', title: 'Refresh budget', amount: 100 } })
  expect(created.status()).toBe(201)
  const entry = FinanceEntrySchema.parse(await created.json())
  await page.goto(`/projects/${project.id}/finance/${entry.id}/edit`)
  const form = page.getByTestId('finance-form')
  await expect(form.locator('#finance-title')).toBeEnabled()
  await form.locator('#finance-title').fill('Draft survives unavailable server')
  expect((await page.request.patch(`${path}/${entry.id}`, { data: { amount: 150, expected_updated_at: entry.updated_at } })).status()).toBe(200)
  const entryPath = `**${path}/${entry.id}`
  await page.route(entryPath, async route => {
    if (route.request().method() === 'GET') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'unavailable', message: 'temporarily unavailable' }) })
    else await route.continue()
  })
  await page.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page.getByTestId('finance-stale')).toBeVisible()
  await expect(page.getByTestId('finance-stale')).toContainText('تعذر تحميل أحدث قيد')
  await expect(page.getByTestId('finance-retry-latest')).toBeVisible()
  await expect(form.locator('#finance-title')).toHaveValue('Draft survives unavailable server')
  await expect(page.getByRole('button', { name: 'حفظ', exact: true })).toBeDisabled()
  await page.unroute(entryPath)
  await page.getByTestId('finance-retry-latest').click()
  await expect(page.getByTestId('finance-stale-latest')).toBeVisible()
  await expect(form.locator('#finance-title')).toHaveValue('Draft survives unavailable server')
  await expect(page.getByRole('button', { name: 'حفظ', exact: true })).toBeDisabled()
  const overwrite = page.getByTestId('finance-stale').getByRole('button', { name: 'حفظ على أحدث مراجعة', exact: true })
  await expect(overwrite).toBeEnabled()
  await overwrite.click()
  await expect(page.getByTestId('finance-entry-detail')).toBeVisible()
  expect((await (await page.request.get(`${path}/${entry.id}`)).json()).title).toBe('Draft survives unavailable server')
})

test('deleting the last entry on a later page returns to a populated page', async ({ page }) => {
  // Fifty-one real writes fill a second page of the ledger (it pages by 50).
  test.setTimeout(120_000)
  await signIn(page, 'pmo_manager')
  const project = await projectWithFinance(page, 'pagination-delete')
  const path = financePath(project)
  for (let i = 0; i < 51; i++) {
    const response = await page.request.post(path, { data: { kind: 'budget', title: `Page item ${i}`, amount: 1 } })
    expect(response.status()).toBe(201)
  }
  await page.goto(`/projects/${project.id}/finance?kind=budget&offset=50`)
  await expect(page.getByTestId('finance-entry-row')).toHaveCount(1)
  await page.getByTestId('finance-entry-row').getByRole('link').click()
  await page.getByTestId('row-actions-menu').click()
  await page.getByRole('menuitem', { name: 'حذف', exact: true }).click()
  await page.getByTestId('finance-delete-confirm').getByRole('button', { name: 'حذف', exact: true }).click()
  await expect(page.getByTestId('finance-entry-row')).toHaveCount(50)
  await expect.poll(() => new URL(page.url()).searchParams.get('offset')).toBeNull()
  await expect(page.getByTestId('project-finance-summary')).toContainText('50.00')
})

test('the ledger and the project dashboard stay usable at a phone viewport', async ({ page }) => {
  await signIn(page, 'pmo_manager')
  const project = await projectWithFinance(page, 'responsive')
  const path = financePath(project)
  expect((await page.request.post(path, { data: { kind: 'budget', title: 'الميزانية التشغيلية', amount: 10000 } })).status()).toBe(201)
  // `/reports` is retired and 301s here; the dashboard is the surface that replaced it.
  await page.goto(`/projects/dashboard?q=${encodeURIComponent(project.name)}`)
  await expect(page.getByTestId('project-dashboard-page')).toBeVisible()
  await expect(page.getByTestId('recent-project-row')).toHaveCount(1)
  await expect(page.getByTestId('recent-project-row')).toContainText(project.name)
  if (process.env.E2E_PHASE2_SCREENSHOTS_DIR) await page.screenshot({ path: `${process.env.E2E_PHASE2_SCREENSHOTS_DIR}/dashboard-desktop.png`, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('recent-project-card')).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  await page.goto(`/projects/${project.id}/finance`)
  await expect(page.getByTestId('project-finance-summary')).toContainText('10000.00')
  await expect(page.getByTestId('finance-entry-card')).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  if (process.env.E2E_PHASE2_SCREENSHOTS_DIR) await page.screenshot({ path: `${process.env.E2E_PHASE2_SCREENSHOTS_DIR}/finance-mobile.png`, fullPage: true })
})
