import { test, expect, type APIResponse, type Page } from '@playwright/test'
import { MilestoneListSchema, ProjectListSchema } from '@liwan/contracts'
import { projectMenuItem, PROJECT_SETTINGS_ITEM } from './support/projectMenu'
import { ACCEPTANCE_ORIGIN, signIn } from './support/realOdooSession'

// Needs a real Odoo: it logs in and writes data, which the mock answers with 404.
// Runs only on the isolated real-Odoo stack (deploy/ci/e2e-odoo.sh).
test.skip(process.env.E2E_REAL_ODOO !== '1', 'Explicit isolated real Odoo acceptance only')

// Phase 3a admin screens: create/settings/stages/followers/milestones/updates
// on the project, task archive, project archive/unarchive, the settings ›
// projects screen, and the employee role's reduced nav/actions. Every project
// this file creates gets its own unique name (Date.now()) and default_stages
// is pinned before every test so "To Do"/"Doing"/"Review"/"Done" are stable
// names to assert on regardless of what earlier runs left in the policy.
const DEFAULT_STAGES = [
  { name: 'To Do', fold: false },
  { name: 'Doing', fold: false },
  { name: 'Review', fold: false },
  { name: 'Done', fold: true },
]

// The policy is pinned from the test's own session: a raw request-fixture login cannot produce
// a session on this stack (two-step sign-in), and page.request carries the cookies of the
// signed-in account.
async function pinProjectPolicy(page: Page) {
  const patched = await page.request.patch('/api/v1/settings/projects', {
    data: { project_creators: 'managers', default_stages: DEFAULT_STAGES },
  })
  if (patched.status() !== 200) throw new Error(`settings patch failed in beforeEach: ${patched.status()}`)
}

test.beforeEach(async ({}, info) => { expect(new URL(String(info.project.use.baseURL)).origin).toBe(ACCEPTANCE_ORIGIN) })

test.beforeEach(async ({ page }) => {
  await signIn(page, 'admin')
  await pinProjectPolicy(page)
})

// The API answers and the pages' own responses share this shape: status, the raw text for a failure message, and JSON.
type WireResponse = Pick<APIResponse, 'status' | 'text' | 'json'>

async function body(response: WireResponse, status = 201) {
  expect(response.status(), await response.text()).toBe(status)
  return response.json()
}

async function createProject(page: Page, name: string, extra: Record<string, unknown> = {}): Promise<number> {
  const project = await body(await page.request.post('/api/v1/projects', { data: { name, date_end: '2035-12-31', ...extra } }))
  return project.id as number
}

// Planning (milestones, schedule, baselines) ships optional and stays off until the project opts in, exactly like
// finance: the tool's routes answer 403 before the preference. The journey opts in the way a customer does, against
// the documented `PATCH /api/v1/projects/{id}` `tool_preferences` contract (the shape projectWithTools uses in
// real-odoo-acceptance.spec.ts), and asserts the default first, so the opt-in is part of the proof.
async function projectWithPlanning(page: Page, name: string): Promise<{ id: number }> {
  // A wide schedule: a milestone's start and deadline must sit inside the project's own dates.
  const id = await createProject(page, name, { date_start: '2000-01-01' })
  const before = await body(await page.request.get(`/api/v1/projects/${id}`), 200)
  expect(before.tools.planning.policy, 'planning policy').toBe('optional')
  expect(before.tools.planning.enabled, 'planning default').toBeFalsy()
  // While the project has not opted in, the tool's own route is refused rather than answering an empty list.
  expect((await page.request.get(`/api/v1/projects/${id}/milestones`)).status(), 'milestones before opt-in').toBe(403)
  const detail = await body(await page.request.patch(`/api/v1/projects/${id}`, {
    data: { expected_updated_at: before.updated_at, tool_preferences: { planning: true } },
  }), 200)
  expect(detail.tools.planning.enabled, 'planning tool').toBe(true)
  expect((await page.request.get(`/api/v1/projects/${id}/milestones`)).status(), 'milestones after opt-in').toBe(200)
  return { id }
}

async function createTask(page: Page, name: string, projectId: number): Promise<number> {
  const task = await body(await page.request.post('/api/v1/tasks', { data: { name, project_id: projectId } }))
  return task.id as number
}

// One day of the open calendar (reka's own primitive attribute), never a padding day of a neighbouring month, and
// only while the calendar's popover is open.
function calendarDays(page: Page) {
  return page.locator('[data-reka-calendar-cell-trigger]:not([data-disabled]):not([data-outside-view]):visible')
}

async function searchProjectList(page: Page, name: string) {
  const search = page.getByPlaceholder('ابحث باسم المشروع…')
  await expect(search).toBeEnabled()
  await search.fill(name)
  await expect(page).toHaveURL((url) => url.searchParams.get('q') === name)
}

test('creating a project from the list lands on its page with the default stage columns', async ({ page }) => {
  const name = `E2E admin create ${Date.now()}`

  await page.goto('/projects')
  await page.getByTestId('project-new').click()
  await expect(page).toHaveURL(/\/projects\/new\?returnTo=/)
  // The create panel is the routed panel over the list, not a stacked dialog.
  await expect(page.getByRole('dialog')).toBeVisible()
  const createForm = page.getByTestId('project-create-form')
  await createForm.getByTestId('project-create-name').fill(name)

  // The end date is an optional detail: the form does not draw it until «إظهار التفاصيل» opens it. The field is
  // located by the accessible name on its trigger button (the charter's «تاريخ الانتهاء» + the chosen day), which is
  // what a reader sees, and the day picked is then checked against the date the server stored.
  await createForm.getByRole('button', { name: 'إظهار التفاصيل' }).click()
  const endDateField = createForm.getByRole('button', { name: /^تاريخ الانتهاء/ })
  await expect(endDateField).toBeVisible()
  await endDateField.click()
  const day = calendarDays(page).nth(9)
  const endDate = await day.getAttribute('data-value')
  expect(endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  await day.click()
  // The panel footer owns the form actions (SharedFormActions teleports them out of the <form>), so the submit
  // button is addressed at page level.
  await page.getByTestId('project-create-submit').click()
  await expect(page).toHaveURL(/\/projects\/\d+\?returnTo=/)
  const createdUrl = new URL(page.url())
  expect(createdUrl.pathname).toMatch(/^\/projects\/\d+$/)
  expect(createdUrl.searchParams.get('returnTo')).toBe('/projects')
  const id = Number(createdUrl.pathname.split('/').pop())
  await expect(page.getByTestId('project-workspace-name')).toHaveText(name)

  const detail = await body(await page.request.get(`/api/v1/projects/${id}`), 200)
  expect(detail.name).toBe(name)
  expect(detail.date_end).toBe(endDate)

  // Stage grouping is the board's opt-in (`?group=stage`); status grouping is the default.
  await page.goto(`/projects/${id}/tasks?view=board&group=stage`)
  for (const stage of DEFAULT_STAGES) {
    // A folded stage (the default "Done") collapses into board-column-folded
    // instead of rendering as a full board-column.
    const testId = stage.fold ? 'board-column-folded' : 'board-column'
    await expect(page.getByTestId(testId).filter({ hasText: stage.name })).toBeVisible()
  }
})

test('project settings: stages, followers, and the visibility switch', async ({ page }) => {
  const name = `E2E settings ${Date.now()}`
  const id = await createProject(page, name)
  // Puts one task in the first default stage ("To Do") so that stage is
  // non-empty and every other default stage stays empty.
  await createTask(page, `${name} task`, id)

  await page.goto(`/projects/${id}`)
  await (await projectMenuItem(page, PROJECT_SETTINGS_ITEM)).click()
  await expect(page).toHaveURL(url => url.pathname === `/projects/${id}/settings`)
  let settings = page.getByTestId('project-settings-page')
  await expect(settings).toBeVisible()

  // --- stages: add, board reflects it, reorder, delete empty, delete non-empty disabled ---
  const extraStage = `Extra ${Date.now()}`
  const stageAdded = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/projects/${id}/stages` && r.request().method() === 'POST')
  await settings.getByTestId('stage-add-input').fill(extraStage)
  await settings.getByTestId('stage-add-input').press('Enter')
  expect((await stageAdded).status()).toBe(201)
  const extraRow = settings.getByTestId('stage-row').filter({ hasText: extraStage })
  await expect(extraRow).toBeVisible()

  // The same handle supports pointer drag and keyboard ordering. Home moves
  // the new last stage to the first position through the real UI event path.
  const reorderHandle = extraRow.getByRole('button', { name: `إعادة ترتيب المرحلة ${extraStage}` })
  await expect(reorderHandle).toBeEnabled()
  const reordered = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/projects/${id}/stages/order` && r.request().method() === 'PUT')
  await reorderHandle.press('Home')
  expect((await reordered).status()).toBe(200)
  await expect(settings.getByTestId('stage-row').first()).toContainText(extraStage)
  await page.reload()
  settings = page.getByTestId('project-settings-page')
  await expect(settings.getByTestId('stage-row').first()).toContainText(extraStage)

  // The board reflects the new stage and the new order.
  await page.goto(`/projects/${id}/tasks?view=board&group=stage`)
  await expect(page.getByTestId('board-column').first()).toContainText(extraStage)

  // Continue the lifecycle on the routed settings page after checking the board.
  await page.goto(`/projects/${id}/settings`)
  settings = page.getByTestId('project-settings-page')
  await expect(settings).toBeVisible()

  // Deleting a stage asks inline above the row, never in a stacked dialog.
  const extraRowAgain = settings.getByTestId('stage-row').filter({ hasText: extraStage })
  await extraRowAgain.getByTestId('stage-delete').click()
  const stageConfirm = settings.getByTestId('stage-delete-confirm')
  await expect(stageConfirm).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const stageDeleted = page.waitForResponse((r) => new URL(r.url()).pathname.startsWith(`/api/v1/projects/${id}/stages/`) && r.request().method() === 'DELETE')
  await stageConfirm.getByTestId('inline-confirm-action').click()
  expect((await stageDeleted).status()).toBeLessThan(300)
  await expect(settings.getByTestId('stage-row').filter({ hasText: extraStage })).toHaveCount(0)

  // "To Do" holds a task: its delete button stays disabled.
  await expect(settings.getByTestId('stage-row').filter({ hasText: 'To Do' }).getByTestId('stage-delete')).toBeDisabled()

  // --- followers -----------------------------------------------------------
  await settings.getByTestId('follower-add').click()
  await page.getByPlaceholder('بحث', { exact: true }).fill('E2E Employee')
  const followerAdded = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/projects/${id}/followers` && r.request().method() === 'POST')
  await page.getByRole('option', { name: 'E2E Employee' }).click()
  expect((await followerAdded).status()).toBe(200)
  await expect(settings.getByTestId('follower-row').filter({ hasText: 'E2E Employee' })).toBeVisible()

  // --- operation: visibility (identity editing belongs to the charter) ---
  const visibilitySaved = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/projects/${id}` && r.request().method() === 'PATCH')
  await page.locator('#project-settings-visibility').click()
  await page.getByRole('option', { name: 'المتابعون فقط' }).click()
  const visibilityResponse = await visibilitySaved
  expect(visibilityResponse.status()).toBe(200)
  await visibilityResponse.finished()
  const afterVisibility = await body(await page.request.get(`/api/v1/projects/${id}`), 200)
  expect(afterVisibility.privacy_visibility).toBe('followers')

  // The choice belongs to the project, so it survives a reload, and the follower list is now its whole audience.
  await page.reload()
  settings = page.getByTestId('project-settings-page')
  await expect(page.locator('#project-settings-visibility')).toContainText('المتابعون فقط')
  // The follower list is now the whole audience; settings says so in its own sentence (the heading helper above already
  // matched a different paragraph that starts with the same two words, so this one is asserted in full).
  await expect(settings.getByText('عند اختيار "المتابعون فقط" لا يرى المشروع إلا من في هذه القائمة', { exact: false })).toBeVisible()
})

test('a milestone created on the project can be linked from the task detail page and its count updates', async ({ page }) => {
  const name = `E2E milestone ${Date.now()}`
  // Milestones are the planning tool: opt the project in through tool_preferences first (see projectWithPlanning).
  const { id } = await projectWithPlanning(page, name)
  const taskId = await createTask(page, `${name} task`, id)
  const milestoneName = `${name} launch`

  await page.goto(`/projects/${id}/milestones`)
  await expect(page.getByTestId('milestone-table')).toBeVisible()
  // The list owns the mint entry (`project-header-create`); the form is the routed create panel.
  await page.getByTestId('project-header-create').click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/milestones/new`))
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'معلم جديد' })).toBeVisible()

  const milestoneForm = page.getByTestId('milestone-form')
  await milestoneForm.getByLabel('الاسم').fill(milestoneName)
  // A new milestone needs both dates, inside the project's schedule.
  await milestoneForm.getByRole('button', { name: /^تاريخ البداية/ }).click()
  await calendarDays(page).nth(4).click()
  await milestoneForm.getByRole('button', { name: /^الموعد/ }).click()
  await calendarDays(page).nth(19).click()
  const milestoneCreated = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/projects/${id}/milestones` && r.request().method() === 'POST')
  // The panel footer owns the actions, so the submit button is addressed there.
  await page.locator('.liwan-create-panel-footer').getByRole('button', { name: 'إنشاء', exact: true }).click()
  const createdMilestone = await body(await milestoneCreated)
  // Creating a milestone opens its record page, keeping the milestone list as the way back.
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/milestones/${createdMilestone.id}\\?returnTo=`))

  await page.goto(`/projects/${id}/milestones`)
  await expect(page.getByTestId('milestone-row').filter({ hasText: milestoneName })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: milestoneName })).toContainText('0 من 0')

  // Linking the task from its own record page raises the milestone's task count.
  await page.goto(`/projects/${id}/tasks/${taskId}`)
  const taskDetail = page.getByTestId('task-detail-page')
  await expect(taskDetail).toBeVisible()
  // The task's milestone control lives in the record aside and ships with the planning tool; it is a UISelect.
  const milestoneSelect = taskDetail.getByTestId('milestone-select')
  await expect(milestoneSelect).toBeVisible()
  const milestoneSaved = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/tasks/${taskId}` && r.request().method() === 'PATCH')
  await milestoneSelect.click()
  await page.getByRole('option', { name: milestoneName }).click()
  const milestoneResponse = await milestoneSaved
  expect(milestoneResponse.status()).toBe(200)
  await milestoneResponse.finished()

  await page.goto(`/projects/${id}/milestones`)
  await expect(page.getByRole('row').filter({ hasText: milestoneName })).toContainText('0 من 1')
  const milestones = MilestoneListSchema.parse(await body(await page.request.get(`/api/v1/projects/${id}/milestones`), 200))
  expect(milestones.items.find(row => row.id === createdMilestone.id)?.task_count).toBe(1)
})

test('posting a project update keeps the status set in settings', async ({ page }) => {
  const name = `E2E update ${Date.now()}`
  const id = await createProject(page, name)

  // The status is set in settings only.
  await page.goto(`/projects/${id}/settings`)
  const statusSaved = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/projects/${id}/status` && r.request().method() === 'POST')
  await page.getByTestId('project-status-select').click()
  await page.getByRole('option', { name: 'معرض للخطر' }).click()
  expect((await statusSaved).status()).toBe(200)

  await page.goto(`/projects/${id}`)
  await page.getByTestId('project-updates-create').click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/updates/new`))
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'تحديث جديد' })).toBeVisible()
  const updateForm = page.getByTestId('project-update-form')
  // An update carries no status of its own: the form has no status control.
  await expect(updateForm.getByLabel('الحالة')).toHaveCount(0)
  await updateForm.getByLabel('العنوان').fill(`${name} update`)
  // The body is the rich-text editor, whose own accessible name is the task description label («الوصف»); the
  // form field above it reads «النص». It is a contenteditable textbox, not a labelled input.
  await updateForm.getByRole('textbox', { name: 'الوصف' }).fill(`${name} body`)
  const updateCreated = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/projects/${id}/updates` && r.request().method() === 'POST')
  // The panel footer owns the actions, so the publish button is addressed at page level.
  await page.getByRole('button', { name: 'نشر تحديث' }).click()
  expect((await updateCreated).status()).toBe(201)
  await expect(page).toHaveURL(new RegExp(`/projects/${id}$`))

  const posted = page.getByTestId('project-overview-latest-update')
  await expect(posted).toContainText(`${name} update`)
  await expect(posted).toContainText(`${name} body`)
  await expect(posted).toContainText('معرض للخطر')
  await expect(page.getByTestId('project-status-select')).toHaveCount(0)
  const detail = await body(await page.request.get(`/api/v1/projects/${id}`), 200)
  expect(detail.status).toBe('at_risk')

  await page.goto(`/projects/${id}/settings`)
  await expect(page.getByTestId('project-status-select')).toContainText('معرض للخطر')
})

test('archiving a task removes it from the project list', async ({ page }) => {
  const name = `E2E task archive ${Date.now()}`
  const taskName = `${name} task`
  const keptName = `${name} kept`
  const id = await createProject(page, name)
  const taskId = await createTask(page, taskName, id)
  // A sibling that is not archived, so the list is never empty and "the archived one is gone" cannot pass by the
  // list simply having rendered nothing.
  await createTask(page, keptName, id)

  // The table is the project task list's default view (the board is `?view=board`).
  await page.goto(`/projects/${id}/tasks`)
  await expect(page.getByTestId('project-tasks-view-table')).toHaveAttribute('aria-pressed', 'true')
  const taskRow = page.getByRole('row').filter({ hasText: taskName })
  await expect(taskRow).toBeVisible()
  await taskRow.getByRole('link', { name: taskName }).click()
  const taskDetail = page.getByTestId('task-detail-page')
  await expect(taskDetail).toBeVisible()
  await taskDetail.getByTestId('task-detail-menu').click()
  await page.getByRole('menuitem', { name: 'أرشفة المهمة' }).click()
  const taskConfirm = taskDetail.getByTestId('task-archive-confirm')
  await expect(taskConfirm).toBeVisible()
  const taskArchived = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/tasks/${taskId}/archive` && r.request().method() === 'POST')
  await taskConfirm.getByTestId('inline-confirm-action').click()
  expect((await taskArchived).status()).toBe(200)

  // Archiving closes the record and returns to the list it was opened from.
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/tasks(\\?|$)`))
  await expect(page.getByRole('row').filter({ hasText: keptName })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: taskName })).toHaveCount(0)
  const listed = await body(await page.request.get(`/api/v1/tasks?project_id=${id}`), 200)
  expect(listed.items.some((task: { id: number }) => task.id === taskId)).toBe(false)
})

test('archiving and unarchiving a project moves it between the active and archived filters', async ({ page }) => {
  const name = `E2E project archive ${Date.now()}`
  const id = await createProject(page, name)

  const activeListResponse = await page.request.get(`/api/v1/projects?q=${encodeURIComponent(name)}`)
  expect(activeListResponse.status()).toBe(200)
  const activeList = ProjectListSchema.parse(await activeListResponse.json())
  expect(activeList.items.some((project) => project.id === id)).toBe(true)

  // Cards is the default view and draws no rows: the row menu belongs to the table view.
  await page.goto('/projects?view=table')
  await searchProjectList(page, name)
  const activeRow = page.getByRole('row').filter({ hasText: name })
  await expect(activeRow.getByTestId('project-row')).toBeVisible({ timeout: 10_000 })
  await activeRow.getByTestId('project-menu').click()
  await page.getByRole('menuitem', { name: 'أرشفة المشروع' }).click()
  const projectConfirm = page.getByTestId('project-archive-confirm')
  await expect(projectConfirm).toBeVisible()
  const archived = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/projects/${id}/archive` && r.request().method() === 'POST')
  await projectConfirm.getByTestId('inline-confirm-action').click()
  expect((await archived).status()).toBe(200)
  await expect(page.getByTestId('project-row').filter({ hasText: name })).toHaveCount(0)

  await page.getByTestId('projects-chip-archived').click()
  await expect(page).toHaveURL((url) => url.searchParams.get('q') === name && url.searchParams.get('archived') === '1')
  const archivedRow = page.getByRole('row').filter({ hasText: name })
  await expect(archivedRow.getByTestId('project-row')).toBeVisible()
  await archivedRow.getByTestId('project-menu').click()
  const unarchived = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/projects/${id}/unarchive` && r.request().method() === 'POST')
  await page.getByRole('menuitem', { name: 'إلغاء الأرشفة' }).click()
  const unarchiveResponse = await unarchived
  expect(unarchiveResponse.status()).toBe(200)
  await unarchiveResponse.finished()
  await expect(page.getByTestId('project-row').filter({ hasText: name })).toHaveCount(0)

  await page.getByTestId('projects-chip-all').click()
  await expect(page).not.toHaveURL(/archived=1/)
  await expect(page).toHaveURL((url) => url.searchParams.get('q') === name)
  const restoredListResponse = await page.request.get(`/api/v1/projects?q=${encodeURIComponent(name)}`)
  expect(restoredListResponse.status()).toBe(200)
  const restoredList = ProjectListSchema.parse(await restoredListResponse.json())
  expect(restoredList.items.some((project) => project.id === id)).toBe(true)
  await page.reload()
  await expect(page).toHaveURL((url) => url.searchParams.get('q') === name)
  await expect(page.getByTestId('project-row').filter({ hasText: name })).toBeVisible({ timeout: 10_000 })
})

test('changing the default stages in settings applies to the next created project', async ({ page }) => {
  const extraStage = `Policy Extra ${Date.now()}`

  await page.goto('/settings/apps/projects')
  const saved = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/settings/projects' && r.request().method() === 'PATCH')
  await page.getByTestId('stage-add-input').fill(extraStage)
  await page.getByTestId('stage-add-input').press('Enter')
  expect((await saved).status()).toBe(200)
  await expect(page.getByTestId('stage-row').filter({ hasText: extraStage })).toBeVisible()

  const name = `E2E policy project ${Date.now()}`
  const id = await createProject(page, name)
  // The policy is applied at creation, not only drawn in the settings editor.
  const detail = await body(await page.request.get(`/api/v1/projects/${id}`), 200)
  expect(detail.stages.map((stage: { name: string }) => stage.name)).toContain(extraStage)

  await page.goto(`/projects/${id}/tasks?view=board&group=stage`)
  await expect(page.getByTestId('board-column').filter({ hasText: extraStage })).toBeVisible()
})

test('an employee sees no project-create button and cannot reach project settings', async ({ page }) => {
  const guardedProject = await createProject(page, `E2E guarded project ${Date.now()}`)
  // signIn clears the cookie jar, so the employee never inherits the admin session. The shell is opened
  // before the nav assertion: signing in through the API leaves the tab on its previous (blank) document.
  await signIn(page, 'reader')
  await page.goto('/projects')
  await expect(page.getByRole('heading', { level: 1, name: 'كل المشاريع' })).toBeVisible()
  // Reading projects is an employee right; creating one is not.
  await expect(page.getByTestId('project-new')).toHaveCount(0)

  // The projects policy surface needs pmo.settings.manage, which the employee role does not grant: the route guard's
  // 403 surface or the page's own no-access notice answers, and either way no policy control renders.
  await page.goto('/settings/apps/projects')
  await expect(page.getByTestId('app-error').or(page.getByText('هذه الصفحة لمدير النظام فقط')).first()).toBeVisible()
  await expect(page.getByTestId('stage-add-input')).toHaveCount(0)
  await expect(page.getByTestId('settings-project-tool-planning')).toHaveCount(0)

  // A project the employee may read but does not manage offers no administration.
  await page.goto(`/projects/${guardedProject}/settings`)
  await expect(page.getByText('لا تملك صلاحية إدارة هذا المشروع')).toBeVisible()
  await expect(page.getByTestId('stage-add-input')).toHaveCount(0)
})

test('project administration direct links expose the not-found state without extra overlays', async ({ page }) => {
  // A non-numeric project id is not a project: the workspace frame draws the not-found state in place, and the
  // settings form (which requires a project) is never mounted.
  await page.goto('/projects/not-an-id/settings')
  await expect(page.getByTestId('project-not-found').first()).toBeVisible()
  await expect(page.getByText('المشروع غير موجود أو لا تملك صلاحية عرضه').first()).toBeVisible()
  await expect(page.getByTestId('project-settings-page')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // A missing project answers the same state and never opens the create panel over it: the frame refuses the
  // section, so neither the routed panel nor its form is mounted at all.
  await page.goto('/projects/999999/milestones/new')
  await expect(page.getByText('المشروع غير موجود أو لا تملك صلاحية عرضه').first()).toBeVisible()
  await expect(page.getByTestId('milestone-form')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // The same answer after a reload, not only on client-side navigation.
  await page.reload()
  await expect(page.getByText('المشروع غير موجود أو لا تملك صلاحية عرضه').first()).toBeVisible()
  await expect(page.getByTestId('milestone-form')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
