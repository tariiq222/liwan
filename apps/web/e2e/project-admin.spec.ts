import { test, expect } from '@playwright/test'
import { ProjectListSchema } from '@nasq/contracts'

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

const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
const EMPLOYEE_LOGIN = 'e2e_emp@example.com'
const EMPLOYEE_PASSWORD = 'e2e_emp_pass_123'

test.beforeAll(async ({ request }) => {
  const login = await request.post('/api/auth/login', { data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD } })
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
  await loginAs(page, ADMIN_LOGIN, ADMIN_PASSWORD)
}

// Idempotent production-flow fixture: create an HR employee, then grant access.
// This keeps the test inside the company-scoped HR security boundary instead
// of relying on low-level res.users RPC to auto-create an unscoped contact.
async function ensureEmployeeUser(page): Promise<number> {
  const listRes = await page.request.get('/api/v1/hr/employees?q=E2E%20Employee&limit=200')
  expect(listRes.status()).toBe(200)
  const list = await listRes.json()
  let employee = list.items.find((item) => item.work_email === EMPLOYEE_LOGIN)
  if (!employee) {
    const createRes = await page.request.post('/api/v1/hr/employees', {
      data: { name: 'E2E Employee', work_email: EMPLOYEE_LOGIN },
    })
    expect(createRes.status()).toBe(201)
    employee = await createRes.json()
  }
  if (!employee.access?.active) {
    const grantRes = await page.request.post(`/api/v1/hr/employees/${employee.id}/access`, {
      data: { password: EMPLOYEE_PASSWORD, role: 'employee' },
    })
    expect(grantRes.status()).toBe(200)
    employee = await grantRes.json()
  }
  expect(employee.user_id).toBeTruthy()
  return employee.user_id as number
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
  const milestoneSaved = page.waitForResponse((r) => r.url().includes(`/api/v1/tasks/${taskId}`) && r.request().method() === 'PATCH')
  await page.getByRole('option', { name: milestoneName }).click()
  const milestoneResponse = await milestoneSaved
  expect(milestoneResponse.status()).toBe(200)
  await milestoneResponse.finished()
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

  const activeListResponse = await page.request.get('/api/v1/projects')
  expect(activeListResponse.status()).toBe(200)
  const activeList = ProjectListSchema.parse(await activeListResponse.json())
  expect(activeList.items.some((project) => project.id === id)).toBe(true)

  await page.goto('/projects')
  const activeRow = page.getByTestId('project-row').filter({ hasText: name })
  await expect(activeRow).toBeVisible({ timeout: 10_000 })
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
  const unarchiveResponse = await unarchived
  expect(unarchiveResponse.status()).toBe(200)
  await unarchiveResponse.finished()
  await expect(page.getByTestId('project-row').filter({ hasText: name })).toHaveCount(0)

  await page.getByRole('tab', { name: 'النشطة' }).click()
  await expect(page).not.toHaveURL(/archived=1/)
  const restoredListResponse = await page.request.get('/api/v1/projects')
  expect(restoredListResponse.status()).toBe(200)
  const restoredList = ProjectListSchema.parse(await restoredListResponse.json())
  expect(restoredList.items.some((project) => project.id === id)).toBe(true)
  await page.reload()
  await expect(page.getByTestId('project-row').filter({ hasText: name })).toBeVisible({ timeout: 10_000 })
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

  await loginAs(page, EMPLOYEE_LOGIN, EMPLOYEE_PASSWORD)
  await expect(page.getByRole('navigation').getByRole('link', { name: 'الإعدادات' })).toHaveCount(0)

  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'المشاريع' })).toBeVisible()
  await expect(page.getByTestId('project-new')).toHaveCount(0)

  await page.goto('/settings/projects')
  await expect(page.getByText('هذه الصفحة لمدير النظام فقط')).toBeVisible()
})
