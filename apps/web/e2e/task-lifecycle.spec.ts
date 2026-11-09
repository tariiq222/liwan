import { test, expect, type Page } from '@playwright/test'
import { ACCEPTANCE_ORIGIN, signIn } from './support/realOdooSession'

// Runs only on the isolated real-Odoo stack (deploy/ci/e2e-odoo.sh).
test.skip(process.env.E2E_REAL_ODOO !== '1', 'Explicit isolated real Odoo acceptance only')

test.beforeEach(async ({}, info) => { expect(new URL(String(info.project.use.baseURL)).origin).toBe(ACCEPTANCE_ORIGIN) })

// The shared helper signs in through the API (password step, then the fixture's remembered device), so it leaves
// the page untouched: the post-sign-in landing is the router's decision, not sign-in's. A signed-in identity lands
// on the foundation home `/` — login.vue:68 navigates to postLoginPath, whose fallback is `/` for an identity that
// carries a capabilities array (app/utils/accessPolicy.ts:92), and pages/index.vue:15 only redirects an identity
// without one. The old `/projects/dashboard` wait described firstAllowedPath, which this flow never reaches.
async function login(page: Page) {
  await signIn(page, 'admin')
  await page.goto('/')
  expect(new URL(page.url()).pathname, 'a signed-in identity lands on the foundation home').toBe('/')
  await expect(page.getByTestId('foundation-home')).toBeVisible()
}

async function createProject(page: Page, name: string) {
  const response = await page.request.post('/api/v1/projects', { data: { name, date_end: '2035-12-31' } })
  expect(response.status()).toBe(201)
  return ((await response.json()).id as number)
}

// Project tools are opt-in per project: `planning` (dependencies and milestones) is `optional` and off by default,
// and a planning field written before that opt-in is refused with 403 "This project tool is not enabled."
// (odoo-addons/liwan_pmo/models/project_tools.py:98-122). A customer opts in with a tool preference, which is a
// locked write and therefore needs the project's current write token.
async function enablePlanning(page: Page, projectId: number) {
  const project = await (await page.request.get(`/api/v1/projects/${projectId}`)).json()
  const optedIn = await page.request.patch(`/api/v1/projects/${projectId}`, {
    data: { expected_updated_at: project.updated_at, tool_preferences: { planning: true } },
  })
  expect(optedIn.status(), await optedIn.text()).toBe(200)
  expect((await optedIn.json()).tools.planning.enabled).toBe(true)
  const dependencies = await page.request.patch(`/api/v1/projects/${projectId}`, { data: { allow_task_dependencies: true } })
  expect(dependencies.status(), await dependencies.text()).toBe(200)
  expect((await dependencies.json()).allow_task_dependencies).toBe(true)
}

async function createTask(page: Page, name: string, projectId: number) {
  const response = await page.request.post('/api/v1/tasks', { data: { name, project_id: projectId } })
  expect(response.status()).toBe(201)
  return ((await response.json()).id as number)
}

test('manager can add a dependency and it survives reload', async ({ page }) => {
  await login(page)
  const stamp = Date.now()
  const projectId = await createProject(page, `E2E dependencies ${stamp}`)
  const firstId = await createTask(page, `E2E dependent ${stamp}`, projectId)
  const prerequisiteId = await createTask(page, `E2E prerequisite ${stamp}`, projectId)
  await enablePlanning(page, projectId)

  await page.goto(`/tasks/${firstId}`)
  await page.getByTestId('task-detail-tabs').getByRole('tab', { name: 'المهام السابقة', exact: true }).click()
  const picker = page.getByTestId('dependency-picker')
  await expect(picker).toBeVisible()
  await picker.getByRole('button', { name: 'إضافة مهمة سابقة' }).click()
  const dependencySaved = page.waitForResponse((response) => response.url().includes(`/api/v1/tasks/${firstId}/dependencies`) && response.request().method() === 'PUT')
  await page.getByRole('option', { name: `E2E prerequisite ${stamp}` }).click()
  const dependencyDetail = await (await dependencySaved).json()
  expect(dependencyDetail.depends_on).toEqual([{ id: prerequisiteId, name: `E2E prerequisite ${stamp}`, state: 'in_progress' }])
  expect(dependencyDetail.state).toBe('waiting')
  await expect(picker).toContainText(`E2E prerequisite ${stamp}`)
  await page.reload()
  await page.getByTestId('task-detail-tabs').getByRole('tab', { name: 'المهام السابقة', exact: true }).click()
  const reloadedPicker = page.getByTestId('dependency-picker')
  await expect(reloadedPicker).toContainText(`E2E prerequisite ${stamp}`)
  const dependencyRemoved = page.waitForResponse((response) => response.url().includes(`/api/v1/tasks/${firstId}/dependencies`) && response.request().method() === 'PUT')
  await reloadedPicker.getByRole('button', { name: 'إزالة المهمة السابقة', exact: true }).click()
  const clearedDetail = await (await dependencyRemoved).json()
  expect(clearedDetail.depends_on).toEqual([])
  await page.reload()
  await page.getByTestId('task-detail-tabs').getByRole('tab', { name: 'المهام السابقة', exact: true }).click()
  await expect(page.getByTestId('dependency-picker')).toBeVisible()
  await expect(page.getByTestId('dependency-picker')).not.toContainText(`E2E prerequisite ${stamp}`)
})

test('a creator can restore an archived task from the archived scope', async ({ page }) => {
  await login(page)
  const stamp = Date.now()
  const projectId = await createProject(page, `E2E archive ${stamp}`)
  const taskId = await createTask(page, `E2E archived task ${stamp}`, projectId)
  const archived = await page.request.post(`/api/v1/tasks/${taskId}/archive`, { data: {} })
  expect(archived.ok()).toBeTruthy()

  // Archived tasks are a scope of the task list, not a page of their own (pages/tasks.vue:25-30). The scope renders
  // TaskArchivedList's table at desktop width: one row per task with its restore action in the row's own control
  // (components/pmo/tasks/TaskArchivedList.vue:71-99); a `li` exists only in the phone layout below 768px.
  const returnTo = `/projects/${projectId}/tasks?view=board&filter=closed`
  await page.goto(`/tasks?scope=archived&filter=mine&returnTo=${encodeURIComponent(returnTo)}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('المهام المؤرشفة')
  const row = page.getByRole('row').filter({ hasText: `E2E archived task ${stamp}` })
  await expect(row).toBeVisible()
  const restored = page.waitForResponse((response) => response.url().includes(`/api/v1/tasks/${taskId}/unarchive`) && response.request().method() === 'POST')
  await row.getByRole('button', { name: 'استعادة', exact: true }).click()
  await restored
  await expect(row).toHaveCount(0)
  const restoredTask = await page.request.get(`/api/v1/tasks/${taskId}`)
  expect(restoredTask.ok()).toBeTruthy()
  expect((await restoredTask.json()).id).toBe(taskId)
  const archivedAgain = await page.request.get('/api/v1/tasks/archived?filter=mine')
  expect((await archivedAgain.json()).items.some((task: { id: number }) => task.id === taskId)).toBeFalsy()
  await page.reload()
  await expect(page.getByRole('row').filter({ hasText: `E2E archived task ${stamp}` })).toHaveCount(0)
  await page.getByRole('link', { name: 'عودة', exact: true }).click()
  await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe(returnTo)
})
