import { test, expect } from '@playwright/test'

// These tests run only against the explicitly isolated migration runtime.
test.beforeEach(async ({ page, baseURL }) => {
  if (!baseURL?.includes(':3469')) throw new Error('Use E2E_BASE_URL=http://127.0.0.1:3469 and the isolated migration database')
  const login = await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })
  expect(login.status()).toBe(200)
})

test('branding saves both exact colors and retains the draft when navigation is cancelled', async ({ page }) => {
  await page.goto('/settings/branding')
  await expect(page.getByTestId('branding-color')).toBeEnabled()
  await page.getByTestId('branding-color').fill('#123456')
  await page.getByTestId('branding-secondary-color').fill('#abcdef')
  await page.getByTestId('branding-submit').click()
  await expect.poll(async () => (await (await page.request.get('/api/v1/admin/branding')).json()).secondary_color).toBe('#abcdef')
  await page.reload()
  await expect(page.getByTestId('branding-secondary-color')).toHaveValue('#abcdef')
  await page.getByTestId('branding-secondary-color').fill('#fedcba')
  await page.locator('[data-testid="module-rail"] a[href="/projects/dashboard"]').click()
  await expect(page.getByTestId('unsaved-changes-dialog')).toBeVisible()
  await page.getByRole('button', { name: 'البقاء في الصفحة', exact: true }).click()
  await expect(page.getByTestId('branding-secondary-color')).toHaveValue('#fedcba')
  await expect(page).toHaveURL(/settings\/branding/)
})

test('project route opens a full-width mobile sheet and keeps query context on return', async ({ page }) => {
  const name = `Nuxt migration ${Date.now()}`
  const created = await page.request.post('/api/v1/projects', { data: { name, date_end: '2035-12-31' } })
  expect(created.status()).toBeLessThan(300)
  const project = await created.json()
  await page.setViewportSize({ width: 740, height: 900 })
  await page.goto(`/projects/${project.id}/tasks/new?returnTo=${encodeURIComponent('/projects?sort=name')}`)
  const overlay = page.getByTestId('project-route-overlay')
  await expect(overlay).toBeVisible()
  const sheet = page.locator('.nasq-ui-route-sheet')
  await expect(sheet).toBeVisible()
  await expect.poll(async () => (await sheet.boundingBox())?.width).toBeGreaterThan(730)
  await page.getByTestId('project-overlay-close').click()
  await expect(page).toHaveURL(/\/projects\?sort=name/)
  await expect(overlay).not.toBeVisible()
})

test('dirty branding prompts before browser reload and cancel retains the draft', async ({ page }) => {
  await page.goto('/settings/branding')
  await page.getByTestId('branding-secondary-color').fill('#fedcba')
  let prompted = false
  page.once('dialog', async dialog => { prompted = dialog.type() === 'beforeunload'; await dialog.dismiss() })
  await page.reload({ timeout: 5000 }).catch(() => undefined)
  expect(prompted).toBe(true)
  await expect(page.getByTestId('branding-secondary-color')).toHaveValue('#fedcba')
})


test('filter Escape restores focus and reopening preserves the search value', async ({ page }) => {
  await page.goto('/tasks')
  const trigger = page.getByRole('button', { name: 'البحث والفلاتر', exact: true })
  await trigger.click()
  const search = page.getByPlaceholder('بحث في العناوين…')
  await expect(search).toBeVisible()
  await search.fill('migration-focus')
  await search.press('Escape')
  await expect(search).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await trigger.press('Enter')
  await expect(search).toBeVisible()
  await expect(search).toHaveValue('migration-focus')
})


test('task sheet menus stay clickable and dependency selection persists', async ({ page }) => {
  const stamp = Date.now()
  const created = await page.request.post('/api/v1/projects', { data: { name: `Menus ${stamp}`, date_end: '2035-12-31' } })
  expect(created.ok()).toBeTruthy()
  const project = await created.json()
  expect((await page.request.patch(`/api/v1/projects/${project.id}`, { data: { allow_task_dependencies: true } })).ok()).toBeTruthy()
  const tasks = []
  for (const name of [`Dependent ${stamp}`, `Prerequisite ${stamp}`]) {
    const response = await page.request.post('/api/v1/tasks', { data: { name, project_id: project.id } })
    expect(response.ok()).toBeTruthy()
    tasks.push(await response.json())
  }
  await page.goto(`/projects/${project.id}/tasks/${tasks[0].id}`)
  await expect(page.locator('.nasq-ui-route-sheet')).toBeVisible()
  await page.locator('summary').filter({ hasText: 'المخرجات والمرفقات والمهام المرتبطة' }).click()
  const picker = page.getByTestId('dependency-picker')
  await picker.getByRole('button', { name: 'إضافة اعتماد', exact: true }).click()
  const option = page.getByRole('option', { name: `Prerequisite ${stamp}`, exact: true })
  await expect(option).toBeVisible()
  await option.click()
  await expect.poll(async () => (await (await page.request.get(`/api/v1/tasks/${tasks[0].id}`)).json()).depends_on.map(item => item.id)).toContain(tasks[1].id)
  await page.keyboard.press('Escape')
  await expect(page.locator('.nasq-ui-route-sheet')).toBeVisible()
  await page.reload()
  await page.locator('summary').filter({ hasText: 'المخرجات والمرفقات والمهام المرتبطة' }).click()
  await expect(page.getByTestId('dependency-picker')).toContainText(`Prerequisite ${stamp}`)
})


test('desktop task record number opens its routed sheet', async ({ page }) => {
  const projectResponse = await page.request.post('/api/v1/projects', { data: { name: `Row ${Date.now()}`, date_end: '2035-12-31' } })
  expect(projectResponse.ok()).toBeTruthy()
  const project = await projectResponse.json()
  const taskResponse = await page.request.post('/api/v1/tasks', { data: { name: 'Clickable number', project_id: project.id } })
  expect(taskResponse.ok()).toBeTruthy()
  const task = await taskResponse.json()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`/projects/${project.id}?tab=tasks`)
  await page.locator('table tbody tr').filter({ hasText: 'Clickable number' }).locator('td').first().click()
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/tasks/${task.id}`))
  await expect(page.locator('.nasq-ui-route-sheet')).toBeVisible()
  expect(errors).toEqual([])
})


test('mobile menu exposes visible module names and navigates successfully', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/projects')
  await expect(page.getByTestId('module-rail')).not.toBeVisible()
  await page.getByTestId('mobile-navigation-trigger').click()
  const menu = page.locator('.nasq-mobile-menu')
  await expect(menu).toBeVisible()
  const link = menu.getByRole('link', { name: 'مهامي', exact: true })
  await expect(link).toBeVisible()
  const label = link.locator('span').last()
  await expect(label).toHaveCSS('opacity', '1')
  await expect(label).toHaveCSS('position', 'static')
  await link.click()
  await expect(page).toHaveURL(/\/tasks$/)
  await expect(menu).not.toBeVisible()
})
