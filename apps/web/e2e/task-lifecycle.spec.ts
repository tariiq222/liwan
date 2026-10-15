import { test, expect } from '@playwright/test'

async function login(page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  const loginButton = page.getByRole('button', { name: 'دخول' })
  await expect(loginButton).toBeEnabled()
  await loginButton.click()
  await expect(page).toHaveURL(/\/projects\/dashboard$/)
}

async function createProject(page, name: string) {
  const response = await page.request.post('/api/v1/projects', { data: { name, date_end: '2035-12-31' } })
  expect(response.status()).toBe(201)
  return ((await response.json()).id as number)
}

async function createTask(page, name: string, projectId: number) {
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
  const setting = await page.request.patch(`/api/v1/projects/${projectId}`, { data: { allow_task_dependencies: true } })
  expect(setting.ok()).toBeTruthy()

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

test('a creator can restore an archived task from the dedicated page', async ({ page }) => {
  await login(page)
  const stamp = Date.now()
  const projectId = await createProject(page, `E2E archive ${stamp}`)
  const taskId = await createTask(page, `E2E archived task ${stamp}`, projectId)
  const archived = await page.request.post(`/api/v1/tasks/${taskId}/archive`, { data: {} })
  expect(archived.ok()).toBeTruthy()

  const returnTo = `/projects/${projectId}/tasks?view=board&filter=closed`
  await page.goto(`/tasks?scope=archived&filter=mine&returnTo=${encodeURIComponent(returnTo)}`)
  const row = page.locator('li').filter({ hasText: `E2E archived task ${stamp}` })
  await expect(row).toBeVisible()
  const restored = page.waitForResponse((response) => response.url().includes(`/api/v1/tasks/${taskId}/unarchive`) && response.request().method() === 'POST')
  await row.getByRole('button', { name: 'استعادة' }).click()
  await restored
  await expect(row).toHaveCount(0)
  const restoredTask = await page.request.get(`/api/v1/tasks/${taskId}`)
  expect(restoredTask.ok()).toBeTruthy()
  expect((await restoredTask.json()).id).toBe(taskId)
  const archivedAgain = await page.request.get('/api/v1/tasks/archived?filter=mine')
  expect((await archivedAgain.json()).items.some((task) => task.id === taskId)).toBeFalsy()
  await page.reload()
  await expect(page.getByText(`E2E archived task ${stamp}`)).toHaveCount(0)
  await page.getByRole('link', { name: 'عودة', exact: true }).click()
  await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe(returnTo)
})
