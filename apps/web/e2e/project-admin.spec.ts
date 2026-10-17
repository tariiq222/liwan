import { test, expect } from '@playwright/test'
import { ProjectListSchema } from '@webvue/contracts'

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
  const submit = page.getByRole('button', { name: 'دخول' })
  await expect(submit).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill(username)
  await page.getByLabel('كلمة المرور').fill(password)
  await submit.click()
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
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
    const me = await (await page.request.get('/api/v1/me')).json()
    const roles = await (await page.request.get('/api/v1/admin/roles')).json()
    const role = roles.items.find((item) => item.key === 'employee')
    expect(role).toBeTruthy()
    if (employee.user_id) {
      const account = await (await page.request.get(`/api/v1/admin/users/${employee.user_id}`)).json()
      const restored = await page.request.post(`/api/v1/admin/users/${account.id}/reactivate`, {
        data: { password: EMPLOYEE_PASSWORD, expected_version: account.version },
      })
      expect(restored.status()).toBe(200)
    } else {
      const grantRes = await page.request.post('/api/v1/admin/users', {
        data: { employee_id: employee.id, password: EMPLOYEE_PASSWORD, assignments: [{ role_id: role.id, scope: { kind: 'company', id: me.company.id } }] },
      })
      expect(grantRes.status()).toBe(201)
      employee.user_id = (await grantRes.json()).id
    }
  }
  expect(employee.user_id).toBeTruthy()
  return employee.user_id as number
}

async function createProject(page, name: string): Promise<number> {
  const res = await page.request.post('/api/v1/projects', { data: { name, date_end: '2035-12-31' } })
  const body = await res.json()
  return body.id as number
}

async function createTask(page, name: string, projectId: number): Promise<number> {
  const res = await page.request.post('/api/v1/tasks', { data: { name, project_id: projectId } })
  return (await res.json()).id as number
}

async function searchProjectList(page, name: string) {
  const search = page.getByPlaceholder('ابحث باسم المشروع…')
  await expect(search).toBeEnabled()
  await search.fill(name)
  await expect(page).toHaveURL((url) => url.searchParams.get('q') === name)
}

test('creating a project from the table lands on its page with the default stage columns', async ({ page }) => {
  await login(page)
  const name = `E2E admin create ${Date.now()}`

  await page.goto('/projects')
  await page.getByTestId('project-new').click()
  await expect(page).toHaveURL(/\/projects\/new\?returnTo=/)
  const createForm = page.getByTestId('project-create-form')
  await createForm.getByTestId('project-create-name').fill(name)
  await createForm.getByTestId('project-create-end-date').click()
  await page.locator('[data-slot="calendar-cell-trigger"]:not([data-outside-view])').nth(10).click()
  await createForm.getByRole('button', { name: 'إنشاء' }).click()
  await expect(page).toHaveURL(/\/projects\/\d+\?returnTo=/)
  const createdUrl = new URL(page.url())
  expect(createdUrl.pathname).toMatch(/^\/projects\/\d+$/)
  expect(createdUrl.searchParams.get('returnTo')).toBe('/projects')
  const id = Number(createdUrl.pathname.split('/').pop())

  await page.goto(`/projects/${id}?tab=board`)
  for (const stage of DEFAULT_STAGES) {
    // A folded stage (the default "Done") collapses into board-column-folded
    // instead of rendering as a full board-column.
    const testId = stage.fold ? 'board-column-folded' : 'board-column'
    await expect(page.getByTestId(testId).filter({ hasText: stage.name })).toBeVisible()
  }
})

test('project settings: visibility, followers, and the full stage lifecycle', async ({ page }) => {
  await login(page)
  await ensureEmployeeUser(page)
  const name = `E2E settings ${Date.now()}`
  const id = await createProject(page, name)
  // Puts one task in the first default stage ("To Do") so that stage is
  // non-empty and every other default stage stays empty.
  await createTask(page, `${name} task`, id)

  await page.goto(`/projects/${id}`)
  await page.getByTestId('project-workspace-settings').click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/settings\\?`))
  let settings = page.getByTestId('project-settings-page')
  await expect(settings).toBeVisible()

  // --- operation: visibility (identity editing belongs to the charter) ---
  const visibilitySaved = page.waitForResponse((r) => r.url().includes(`/api/v1/projects/${id}`) && r.request().method() === 'PATCH')
  await settings.getByText('كل الموظفين', { exact: true }).click()
  await page.getByRole('option', { name: 'المتابعون فقط' }).click()
  await visibilitySaved

  // --- stages: add, board reflects it, reorder, delete empty, delete non-empty disabled ---
  const extraStage = `Extra ${Date.now()}`
  const stageAdded = page.waitForResponse((r) => r.url().includes(`/api/v1/projects/${id}/stages`) && r.request().method() === 'POST')
  await settings.getByTestId('stage-add-input').fill(extraStage)
  await settings.getByTestId('stage-add-input').press('Enter')
  await stageAdded
  const extraRow = settings.getByTestId('stage-row').filter({ hasText: extraStage })
  await expect(extraRow).toBeVisible()

  // The same handle supports pointer drag and keyboard ordering. Home moves
  // the new last stage to the first position through the real UI event path.
  const reorderHandle = extraRow.getByRole('button', { name: new RegExp(`إعادة ترتيب المرحلة ${extraStage}`) })
  await expect(reorderHandle).toBeEnabled()
  const reordered = page.waitForResponse((r) => r.url().includes(`/api/v1/projects/${id}/stages/order`) && r.request().method() === 'PUT')
  await reorderHandle.press('Home')
  await reordered
  await expect(settings.getByTestId('stage-row').first()).toContainText(extraStage)
  await page.reload()
  settings = page.getByTestId('project-settings-page')
  await expect(settings.getByTestId('stage-row').first()).toContainText(extraStage)

  // The board reflects the new stage and the new order.
  await page.keyboard.press('Escape')
  await page.goto(`/projects/${id}?tab=board`)
  await expect(page.getByTestId('board-column').filter({ hasText: extraStage })).toBeVisible()

  // Continue the lifecycle on the routed settings page after checking the
  // board; the settings form is intentionally unmounted on the project route.
  await page.goto(`/projects/${id}/settings?returnTo=${encodeURIComponent(`/projects/${id}?tab=board`)}`)
  settings = page.getByTestId('project-settings-page')
  await expect(settings).toBeVisible()

  // Delete the (empty) stage we just added.
  const extraRowAgain = settings.getByTestId('stage-row').filter({ hasText: extraStage })
  await extraRowAgain.getByTestId('stage-delete').click()
  await expect(settings.getByTestId('stage-row').filter({ hasText: extraStage })).toHaveCount(0)

  // "To Do" holds a task: its delete button stays disabled.
  await expect(settings.getByTestId('stage-row').filter({ hasText: 'To Do' }).getByTestId('stage-delete')).toBeDisabled()

  // --- followers -----------------------------------------------------------
  await expect(settings.getByText('عند اختيار')).toBeVisible()
  await settings.getByTestId('follower-add').click()
  await page.getByPlaceholder('بحث', { exact: true }).fill('E2E Employee')
  await page.getByRole('option', { name: 'E2E Employee' }).click()
  await expect(settings.getByTestId('follower-row').filter({ hasText: 'E2E Employee' })).toBeVisible()
})

test('a milestone created on the project can be linked from the task detail page and its count updates', async ({ page }) => {
  await login(page)
  const name = `E2E milestone ${Date.now()}`
  const id = await createProject(page, name)
  const taskId = await createTask(page, `${name} task`, id)
  const milestoneName = `${name} launch`

  await page.goto(`/projects/${id}?tab=milestones`)
  await page.getByTestId('milestone-new').click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/milestones/new`))
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'معلم جديد' })).toBeVisible()
  const milestoneForm = page.getByTestId('milestone-form')
  await milestoneForm.getByLabel('الاسم').fill(milestoneName)
  await milestoneForm.getByRole('button', { name: 'إنشاء' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/milestones/\\d+/edit\\?returnTo=`))
  await page.goto(`/projects/${id}?tab=milestones`)
  await expect(page.getByTestId('milestone-row').filter({ hasText: milestoneName })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: milestoneName })).toContainText('0 من 0')

  await page.goto(`/projects/${id}/tasks/${taskId}?tab=milestones`)
  const taskDetail = page.getByTestId('task-detail-page')
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

test('posting a project update keeps the status set in settings', async ({ page }) => {
  await login(page)
  const name = `E2E update ${Date.now()}`
  const id = await createProject(page, name)

  await page.goto(`/projects/${id}?tab=updates`)
  await page.getByTestId('project-update-new').click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/updates/new`))
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'تحديث جديد' })).toBeVisible()
  const updateForm = page.getByTestId('project-update-form')
  await expect(updateForm.getByLabel('الحالة')).toHaveCount(0)
  await updateForm.getByLabel('العنوان').fill(`${name} update`)
  await updateForm.getByRole('button', { name: 'إنشاء' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}\\?tab=updates`))

  await expect(page.getByTestId('project-update').filter({ hasText: `${name} update` })).toBeVisible()
  await expect(page.getByTestId('project-status-select')).toHaveCount(0)
  await page.goto(`/projects/${id}/settings`)
  await expect(page.getByTestId('project-status-select')).toBeVisible()
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
  await taskDetail.getByTestId('task-archive').click()
  const taskConfirm = taskDetail.getByTestId('task-archive-confirm')
  await expect(taskConfirm).toBeVisible()
  await taskConfirm.getByRole('button', { name: 'أرشفة المهمة' }).click()

  await expect(page).toHaveURL(new RegExp(`/projects/${id}\\?tab=list`))
  await expect(page.getByRole('row', { name: new RegExp(`${name} task`) })).toHaveCount(0)
})

test('archiving and unarchiving a project moves it between the active and archived filters', async ({ page }) => {
  await login(page)
  const name = `E2E project archive ${Date.now()}`
  const id = await createProject(page, name)

  const activeListResponse = await page.request.get(`/api/v1/projects?q=${encodeURIComponent(name)}`)
  expect(activeListResponse.status()).toBe(200)
  const activeList = ProjectListSchema.parse(await activeListResponse.json())
  expect(activeList.items.some((project) => project.id === id)).toBe(true)

  await page.goto('/projects')
  await searchProjectList(page, name)
  const activeRow = page.getByTestId('project-row').filter({ hasText: name })
  await expect(activeRow).toBeVisible({ timeout: 10_000 })
  await activeRow.getByTestId('project-menu').click()
  await page.getByRole('menuitem', { name: 'أرشفة المشروع' }).click()
  const projectConfirm = page.getByTestId('project-archive-confirm')
  await expect(projectConfirm).toBeVisible()
  const archived = page.waitForResponse((r) => r.url().includes(`/api/v1/projects/${id}/archive`) && r.request().method() === 'POST')
  await projectConfirm.getByRole('button', { name: 'أرشفة المشروع' }).click()
  await archived
  await expect(page.getByTestId('project-row').filter({ hasText: name })).toHaveCount(0)

  await page.getByTestId('projects-scope').getByRole('button', { name: 'المؤرشفة' }).click()
  await expect(page).toHaveURL((url) => url.searchParams.get('q') === name && url.searchParams.get('archived') === '1')
  const archivedRow = page.getByTestId('project-row').filter({ hasText: name })
  await expect(archivedRow).toBeVisible()
  await archivedRow.getByTestId('project-menu').click()
  const unarchived = page.waitForResponse((r) => r.url().includes(`/api/v1/projects/${id}/unarchive`) && r.request().method() === 'POST')
  await page.getByRole('menuitem', { name: 'إلغاء الأرشفة' }).click()
  const unarchiveResponse = await unarchived
  expect(unarchiveResponse.status()).toBe(200)
  await unarchiveResponse.finished()
  await expect(page.getByTestId('project-row').filter({ hasText: name })).toHaveCount(0)

  await page.getByTestId('projects-scope').getByRole('button', { name: 'النشطة' }).click()
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
  await login(page)
  const extraStage = `Policy Extra ${Date.now()}`

  await page.goto('/projects/settings')
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
  const guardedProject = await createProject(page, `E2E guarded project ${Date.now()}`)
  await page.context().clearCookies()

  await loginAs(page, EMPLOYEE_LOGIN, EMPLOYEE_PASSWORD)
  await expect(page.getByRole('navigation').getByRole('link', { name: 'إعدادات المشاريع', exact: true })).toHaveCount(0)
  await expect(page.getByRole('navigation').getByRole('link', { name: 'المستخدمون', exact: true })).toHaveCount(0)

  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'المشاريع' })).toBeVisible()
  await expect(page.getByTestId('project-new')).toHaveCount(0)

  await page.goto('/projects/settings')
  await expect(page.getByRole('heading', { name: 'هذه الصفحة لمدير النظام فقط' })).toBeVisible()
  await page.goto(`/projects/${guardedProject}/settings`)
  await expect(page.getByText('لا تملك صلاحية إدارة هذا المشروع')).toBeVisible()
})

test('project administration direct links expose invalid and forbidden states without overlays', async ({ page }) => {
  await login(page)

  await page.goto('/projects/not-an-id/settings')
  await expect(page.getByText('معرّف المشروع غير صالح')).toBeVisible()
  await expect(page.locator('[data-slot="dialog-content"], [data-slot="sheet-content"], [data-slot="dialog-overlay"], [data-slot="sheet-overlay"]')).toHaveCount(0)

  await page.goto('/projects/999999/milestones/new')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText('المشروع غير موجود أو لا تملك صلاحية عرضه')).toBeVisible()
  await page.reload()
  await expect(page.getByText('المشروع غير موجود أو لا تملك صلاحية عرضه')).toBeVisible()
})
