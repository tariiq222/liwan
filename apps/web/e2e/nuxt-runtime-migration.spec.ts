import { test, expect } from '@playwright/test'

// The caller must select an isolated scratch runtime; an exact port never proves DB isolation.
test.beforeEach(async ({ page, baseURL }) => {
  expect(baseURL).toBeDefined()
  const login = await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })
  expect(login.status()).toBe(200)
})

test('branding saves the primary color and retains the draft when navigation is cancelled', async ({ page }) => {
  await page.goto('/settings/branding')
  const primary = page.getByTestId('branding-color')
  await expect(primary).toBeEnabled()
  await expect(page.getByTestId('branding-secondary-color')).toHaveCount(0)
  const initialResponse = await page.request.get('/api/v1/admin/branding')
  expect(initialResponse.status()).toBe(200)
  const initialBranding = await initialResponse.json() as { primary_color: string; secondary_color?: unknown }
  const initialSecondary = initialBranding.secondary_color

  try {
    await primary.fill('#123456')
    const save = page.waitForResponse(response => (
      response.url().includes('/api/v1/admin/branding') && response.request().method() === 'PATCH'
    ))
    await page.getByTestId('branding-submit').click()
    const saveResponse = await save
    expect(saveResponse.status()).toBe(200)
    expect(saveResponse.request().postDataJSON()).toEqual({ primary_color: '#123456' })
    await expect.poll(async () => {
      const branding = await (await page.request.get('/api/v1/admin/branding')).json()
      return { primary_color: branding.primary_color, secondary_color: branding.secondary_color }
    }).toEqual({ primary_color: '#123456', secondary_color: initialSecondary })
    await page.reload()
    await expect(primary).toHaveValue('#123456')
    await expect(page.getByTestId('branding-secondary-color')).toHaveCount(0)
    await primary.fill('#fedcba')
    await page.locator('[data-testid="module-rail"] a[href="/projects/dashboard"]').click()
    await expect(page.getByTestId('unsaved-changes-dialog')).toBeVisible()
    await page.getByRole('button', { name: 'البقاء في الصفحة', exact: true }).click()
    await expect(primary).toHaveValue('#fedcba')
    await expect(page).toHaveURL(/settings\/branding/)
  } finally {
    const restore = await page.request.patch('/api/v1/admin/branding', { data: { primary_color: initialBranding.primary_color } })
    expect(restore.status()).toBe(200)
  }
})

test('project route opens a full-width mobile sheet and keeps query context on return', async ({ page }) => {
  const name = `Nuxt migration ${Date.now()}`
  const created = await page.request.post('/api/v1/projects', { data: { name, date_end: '2035-12-31' } })
  expect(created.status()).toBeLessThan(300)
  const project = await created.json()
  await page.setViewportSize({ width: 740, height: 900 })
  await page.goto(`/projects/${project.id}/tasks/new?returnTo=${encodeURIComponent('/projects?sort=name')}`)
  const panel = page.getByRole('dialog')
  await expect(panel).toBeVisible()
  await expect.poll(async () => (await panel.boundingBox())?.width).toBeGreaterThan(730)
  await page.getByRole('button', { name: 'إغلاق' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/tasks`))
  await expect(panel).toHaveCount(0)
})

test('dirty branding prompts before browser reload and cancel retains the draft', async ({ page }) => {
  await page.goto('/settings/branding')
  const primary = page.getByTestId('branding-color')
  await expect(page.getByTestId('branding-secondary-color')).toHaveCount(0)
  const initialResponse = await page.request.get('/api/v1/admin/branding')
  expect(initialResponse.status()).toBe(200)
  const initialBranding = await initialResponse.json() as { primary_color: string; secondary_color?: unknown }
  try {
    await primary.fill('#fedcba')
    let prompted = false
    page.once('dialog', async dialog => { prompted = dialog.type() === 'beforeunload'; await dialog.dismiss() })
    await page.reload({ timeout: 5000 }).catch(() => undefined)
    expect(prompted).toBe(true)
    await expect(primary).toHaveValue('#fedcba')
    await expect(page.getByTestId('branding-secondary-color')).toHaveCount(0)
    await expect.poll(async () => (await (await page.request.get('/api/v1/admin/branding')).json()).secondary_color).toEqual(initialBranding.secondary_color)
  } finally {
    const restore = await page.request.patch('/api/v1/admin/branding', { data: { primary_color: initialBranding.primary_color } })
    expect(restore.status()).toBe(200)
  }
})


test('filter Escape restores focus and reopening preserves the search value', async ({ page }) => {
  await page.goto('/tasks')
  const filterRoot = page.locator('[data-slot="filter-root"]')
  const trigger = filterRoot.getByRole('button', { name: 'البحث والفلاتر', exact: true })
  const search = filterRoot.getByPlaceholder('بحث في العناوين…')
  await expect(search).toBeVisible()
  await search.fill('migration-focus')
  await trigger.click()
  const fields = page.locator('[data-slot="filter-fields"]')
  await expect(fields).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  const contentId = await trigger.getAttribute('aria-controls')
  expect(contentId).toBeTruthy()
  await expect(fields).toHaveAttribute('id', contentId!)
  await expect(fields).toHaveAttribute('aria-busy', 'false')
  const stateFilter = fields.getByRole('button', { name: 'كل الحالات', exact: true })
  await expect(stateFilter).toBeVisible()
  await stateFilter.focus()
  await expect(stateFilter).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(fields).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await expect(search).toBeVisible()
  await expect(search).toHaveValue('migration-focus')
  await trigger.press('Enter')
  await expect(fields).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(fields.getByRole('button', { name: 'كل الحالات', exact: true })).toBeVisible()
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
  const tabs = page.getByTestId('task-detail-tabs')
  await expect(tabs.getByRole('tab', { name: 'التفاصيل', exact: true })).toHaveAttribute('data-state', 'active')
  await tabs.getByRole('tab', { name: 'الموارد', exact: true }).click()
  await expect(tabs.getByRole('tab', { name: 'الموارد', exact: true })).toHaveAttribute('data-state', 'active')
  const picker = page.getByTestId('dependency-picker')
  await expect(picker).toBeVisible()
  const dependencyTrigger = picker.getByRole('button', { name: 'إضافة اعتماد', exact: true })
  await expect(dependencyTrigger).toBeVisible()
  await dependencyTrigger.click()
  const option = page.getByRole('option', { name: `Prerequisite ${stamp}`, exact: true })
  await expect(option).toBeVisible()
  await option.click()
  await expect.poll(async () => (await (await page.request.get(`/api/v1/tasks/${tasks[0].id}`)).json()).depends_on.map(item => item.id)).toContain(tasks[1].id)
  await page.keyboard.press('Escape')
  await expect(page.locator('.nasq-ui-route-sheet')).toBeVisible()
  await page.reload()
  const reloadedTabs = page.getByTestId('task-detail-tabs')
  await reloadedTabs.getByRole('tab', { name: 'الموارد', exact: true }).click()
  await expect(reloadedTabs.getByRole('tab', { name: 'الموارد', exact: true })).toHaveAttribute('data-state', 'active')
  await expect(page.getByTestId('dependency-picker')).toBeVisible()
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
