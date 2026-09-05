import { test, expect } from '@playwright/test'

// Phase 3a admin screens: create/settings/stages/followers/milestones/updates
// on the project, task archive, project archive/unarchive, the settings ›
// projects screen, and the employee role's reduced nav/actions. Every project
// this file creates gets its own unique name (Date.now()) and default_stages
// is pinned once up front so "To Do"/"Doing"/"Review"/"Done" are stable names
// to assert on regardless of what earlier runs left in the policy.
const DEFAULT_STAGES = [
  { name: 'To Do', fold: false },
  { name: 'Doing', fold: false },
  { name: 'Review', fold: false },
  { name: 'Done', fold: true },
]

test.beforeAll(async ({ request }) => {
  const login = await request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })
  if (login.status() !== 200) throw new Error(`admin login failed in beforeAll: ${login.status()}`)
  const patched = await request.patch('/api/v1/settings/projects', {
    data: { project_creators: 'managers', default_stages: DEFAULT_STAGES },
  })
  if (patched.status() !== 200) throw new Error(`settings patch failed in beforeAll: ${patched.status()}`)
})

async function loginAs(page, username: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill(username)
  await page.getByLabel('كلمة المرور').fill(password)
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
}

async function login(page) {
  await loginAs(page, 'admin', 'admin')
}

// Odoo RPC fixtures (same session cookie as the UI login), same pattern as
// projects.spec.ts used before phase 3a had a create-project endpoint.
async function callKw(page, model: string, method: string, args: unknown[]) {
  const res = await page.request.post(`/web/dataset/call_kw/${model}/${method}`, {
    data: { jsonrpc: '2.0', method: 'call', params: { model, method, args, kwargs: {} } },
  })
  const body = await res.json()
  if (body.error) throw new Error(JSON.stringify(body.error.data?.message ?? body.error))
  return body.result
}

// Idempotent: reuses the user if a previous run already created it.
// create_employee:true (odoo/addons/hr/models/res_users.py) makes the create
// also create a linked hr.employee row, which is what /api/v1/people (and so
// the follower/manager pickers) actually query.
async function ensureEmployeeUser(page): Promise<number> {
  const existing = await callKw(page, 'res.users', 'search_read', [[['login', '=', 'e2e_emp']], ['id']])
  if (existing.length > 0) return existing[0].id
  const groupRows = await callKw(page, 'ir.model.data', 'search_read', [
    [['module', '=', 'nasq_core'], ['name', '=', 'group_employee']],
    ['res_id'],
  ])
  const groupId = groupRows[0].res_id
  return callKw(page, 'res.users', 'create', [{
    login: 'e2e_emp',
    password: 'e2e_emp_pass_123',
    name: 'E2E Employee',
    group_ids: [[6, 0, [groupId]]],
    create_employee: true,
  }])
}

async function createProject(page, name: string): Promise<number> {
  const res = await page.request.post('/api/v1/projects', { data: { name } })
  const body = await res.json()
  return body.id as number
}

async function createTask(page, name: string, projectId: number): Promise<number> {
  const res = await page.request.post('/api/v1/tasks', { data: { name, project_id: projectId } })
  return (await res.json()).id as number
}

// Real pointer-event drag (vue-draggable-plus/SortableJS reacts to pointer
// events, not the HTML5 drag protocol) — same technique as projects.spec.ts
// and board.spec.ts's dragCard, generalised for any two locators.
async function drag(page, fromLocator, toLocator) {
  await fromLocator.scrollIntoViewIfNeeded()
  const from = await fromLocator.boundingBox()
  const to = await toLocator.boundingBox()
  if (!from || !to) throw new Error('missing bounding box for drag')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  const targetX = to.x + to.width / 2
  const targetY = to.y + Math.min(8, to.height / 2)
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from.x + from.width / 2 + ((targetX - (from.x + from.width / 2)) * i) / 10, from.y + from.height / 2 + ((targetY - (from.y + from.height / 2)) * i) / 10)
    await page.waitForTimeout(20)
  }
  await page.mouse.up()
}

test('creating a project from the table lands on its page with the default stage columns', async ({ page }) => {
  await login(page)
  const name = `E2E admin create ${Date.now()}`

  await page.goto('/projects')
  await page.getByTestId('project-new').click()
  const createDialog = page.getByRole('dialog')
  await createDialog.getByTestId('project-create-name').fill(name)
  await createDialog.getByRole('button', { name: 'إنشاء' }).click()
  await expect(page).toHaveURL(/\/projects\/\d+$/)
  const id = Number(new URL(page.url()).pathname.split('/').pop())

  await page.goto(`/projects/${id}?tab=board`)
  for (const stage of DEFAULT_STAGES) {
    // A folded stage (the default "Done") collapses into board-column-folded
    // instead of rendering as a full board-column.
    const testId = stage.fold ? 'board-column-folded' : 'board-column'
    await expect(page.getByTestId(testId).filter({ hasText: stage.name })).toBeVisible()
  }
})

test('project settings: rename and visibility, followers, and the full stage lifecycle', async ({ page }) => {
  await login(page)
  await ensureEmployeeUser(page)
  const name = `E2E settings ${Date.now()}`
  const id = await createProject(page, name)
  // Puts one task in the first default stage ("To Do") so that stage is
  // non-empty and every other default stage stays empty.
  await createTask(page, `${name} task`, id)

  await page.goto(`/projects/${id}`)
  await page.getByTestId('project-menu').click()
  await page.getByRole('menuitem', { name: 'إعدادات المشروع' }).click()
  const dialog = page.getByTestId('project-settings-dialog')
  await expect(dialog).toBeVisible()

  // --- general: rename + visibility ---------------------------------------
  const renamed = `${name} renamed`
  const nameInput = dialog.getByLabel('الاسم')
  await nameInput.fill(renamed)
  const nameSaved = page.waitForResponse((r) => r.url().includes(`/api/v1/projects/${id}`) && r.request().method() === 'PATCH')
  await nameInput.blur()
  await nameSaved

  const visibilitySaved = page.waitForResponse((r) => r.url().includes(`/api/v1/projects/${id}`) && r.request().method() === 'PATCH')
  await dialog.getByRole('combobox').click()
  await page.getByRole('option', { name: 'المتابعون فقط' }).click()
  await visibilitySaved

  // --- stages: add, board reflects it, reorder, delete empty, delete non-empty disabled ---
  await dialog.getByRole('tab', { name: 'المراحل' }).click()
  const extraStage = `Extra ${Date.now()}`
  const stageAdded = page.waitForResponse((r) => r.url().includes(`/api/v1/projects/${id}/stages`) && r.request().method() === 'POST')
  await dialog.getByTestId('stage-add-input').fill(extraStage)
  await dialog.getByTestId('stage-add-input').press('Enter')
  await stageAdded
  const extraRow = dialog.getByTestId('stage-row').filter({ hasText: extraStage })
  await expect(extraRow).toBeVisible()

  // Reorder: drag the new (last) stage above "To Do" (the first).
  const todoRow = dialog.getByTestId('stage-row').filter({ hasText: 'To Do' })
  const reordered = page.waitForResponse((r) => r.url().includes(`/api/v1/projects/${id}/stages/order`) && r.request().method() === 'PUT')
  await drag(page, extraRow.locator('.stage-drag-handle'), todoRow)
  await reordered
  await expect(dialog.getByTestId('stage-row').first()).toContainText(extraStage)

  // The board reflects the new stage and the new order.
  await page.keyboard.press('Escape')
  await page.goto(`/projects/${id}?tab=board`)
  await expect(page.getByTestId('board-column').filter({ hasText: extraStage })).toBeVisible()

  // Re-open settings > stages to finish the lifecycle checks.
  await page.getByTestId('project-menu').click()
  await page.getByRole('menuitem', { name: 'إعدادات المشروع' }).click()
  await dialog.getByRole('tab', { name: 'المراحل' }).click()

  // Delete the (empty) stage we just added.
  const extraRowAgain = dialog.getByTestId('stage-row').filter({ hasText: extraStage })
  await extraRowAgain.getByTestId('stage-delete').click()
  await expect(dialog.getByTestId('stage-row').filter({ hasText: extraStage })).toHaveCount(0)

  // "To Do" holds a task: its delete button stays disabled.
  await expect(dialog.getByTestId('stage-row').filter({ hasText: 'To Do' }).getByTestId('stage-delete')).toBeDisabled()

  // --- followers -----------------------------------------------------------
  await dialog.getByRole('tab', { name: 'المتابعون' }).click()
  await expect(dialog.getByText('عند اختيار')).toBeVisible()
  await dialog.getByTestId('follower-add').click()
  await page.getByPlaceholder('بحث', { exact: true }).fill('E2E Employee')
  await page.getByRole('option', { name: 'E2E Employee' }).click()
  await expect(dialog.getByTestId('follower-row').filter({ hasText: 'E2E Employee' })).toBeVisible()
})

test('a milestone created on the project can be linked from the task detail page and its count updates', async ({ page }) => {
  await login(page)
  const name = `E2E milestone ${Date.now()}`
  const id = await createProject(page, name)
  const taskId = await createTask(page, `${name} task`, id)
  const milestoneName = `${name} launch`

  await page.goto(`/projects/${id}?tab=milestones`)
  await page.getByTestId('milestone-new').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('الاسم').fill(milestoneName)
  await dialog.getByRole('button', { name: 'إنشاء' }).click()
  await expect(page.getByRole('row').filter({ hasText: milestoneName })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: milestoneName })).toContainText('0 من 0')

  await page.goto(`/projects/${id}/tasks/${taskId}?tab=milestones`)
  const taskDetail = page.getByTestId('task-detail-page')
  await taskDetail.getByText('تفاصيل إضافية').click()
  await taskDetail.getByTestId('milestone-select').click()
  await page.getByRole('option', { name: milestoneName }).click()
  await page.keyboard.press('Escape')

  await page.goto(`/projects/${id}?tab=milestones`)
  await expect(page.getByRole('row').filter({ hasText: milestoneName })).toContainText('0 من 1')
})

test('posting a project update changes the header status badge', async ({ page }) => {
  await login(page)
  const name = `E2E update ${Date.now()}`
  const id = await createProject(page, name)

  await page.goto(`/projects/${id}?tab=updates`)
  await page.getByTestId('project-update-new').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('الحالة').click()
  await page.getByRole('option', { name: 'خارج المسار' }).click()
  await dialog.getByLabel('العنوان').fill(`${name} update`)
  await dialog.getByRole('button', { name: 'إنشاء' }).click()

  await expect(page.getByTestId('project-update').filter({ hasText: `${name} update` })).toBeVisible()
  await expect(page.getByTestId('project-status-select')).toContainText('خارج المسار')
  await page.reload()
  await expect(page.getByTestId('project-status-select')).toContainText('خارج المسار')
})

test('archiving a task removes it from the project list', async ({ page }) => {
  await login(page)
  const name = `E2E task archive ${Date.now()}`
  const id = await createProject(page, name)
  await createTask(page, `${name} task`, id)

  await page.goto(`/projects/${id}?tab=list`)
  await page.getByRole('row', { name: new RegExp(`${name} task`) }).click()
  const taskDetail = page.getByTestId('task-detail-page')
  await expect(taskDetail).toBeVisible()
  await taskDetail.getByTestId('task-menu').click()
  await page.getByTestId('task-archive').click()
  await page.getByRole('button', { name: 'أرشفة المهمة' }).click()

  await expect(page).toHaveURL(new RegExp(`/projects/${id}\\?tab=list`))
  await expect(page.getByRole('row', { name: new RegExp(`${name} task`) })).toHaveCount(0)
})

test('archiving and unarchiving a project moves it between the active and archived filters', async ({ page }) => {
  await login(page)
  const name = `E2E project archive ${Date.now()}`
  const id = await createProject(page, name)

  await page.goto('/projects')
  const activeRow = page.getByTestId('project-row').filter({ hasText: name })
  await expect(activeRow).toBeVisible()
  await activeRow.getByTestId('project-menu').click()
  await page.getByRole('menuitem', { name: 'أرشفة المشروع' }).click()
  const archived = page.waitForResponse((r) => r.url().includes(`/api/v1/projects/${id}/archive`) && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'أرشفة المشروع' }).click()
  await archived
  await expect(page.getByTestId('project-row').filter({ hasText: name })).toHaveCount(0)

  await page.getByRole('tab', { name: 'المؤرشفة' }).click()
  const archivedRow = page.getByTestId('project-row').filter({ hasText: name })
  await expect(archivedRow).toBeVisible()
  await archivedRow.getByTestId('project-menu').click()
  const unarchived = page.waitForResponse((r) => r.url().includes(`/api/v1/projects/${id}/unarchive`) && r.request().method() === 'POST')
  await page.getByRole('menuitem', { name: 'إلغاء الأرشفة' }).click()
  await unarchived
  await expect(page.getByTestId('project-row').filter({ hasText: name })).toHaveCount(0)

  await page.getByRole('tab', { name: 'النشطة' }).click()
  await expect(page).not.toHaveURL(/archived=1/)
  await page.reload()
  await expect(page.getByTestId('project-row').filter({ hasText: name })).toBeVisible()
})

test('changing the default stages in settings applies to the next created project', async ({ page }) => {
  await login(page)
  const extraStage = `Policy Extra ${Date.now()}`

  await page.goto('/settings/projects')
  const saved = page.waitForResponse((r) => r.url().includes('/api/v1/settings/projects') && r.request().method() === 'PATCH')
  await page.getByTestId('stage-add-input').fill(extraStage)
  await page.getByTestId('stage-add-input').press('Enter')
  await saved

  const name = `E2E policy project ${Date.now()}`
  const id = await createProject(page, name)
  await page.goto(`/projects/${id}?tab=board`)
  await expect(page.getByTestId('board-column').filter({ hasText: extraStage })).toBeVisible()
})

test('an employee sees no project-create button and no settings nav entry', async ({ page }) => {
  await login(page)
  await ensureEmployeeUser(page)
  await page.context().clearCookies()

  await loginAs(page, 'e2e_emp', 'e2e_emp_pass_123')
  await expect(page.getByRole('navigation').getByRole('link', { name: 'الإعدادات' })).toHaveCount(0)

  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'المشاريع' })).toBeVisible()
  await expect(page.getByTestId('project-new')).toHaveCount(0)

  await page.goto('/settings/projects')
  await expect(page.getByText('هذه الصفحة لمدير النظام فقط')).toBeVisible()
})
