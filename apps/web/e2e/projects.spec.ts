import { test, expect, type Page } from '@playwright/test'

function projectListParams(page: Page) {
  return new URL(page.url()).searchParams
}

// Phase 3a: there is now a real create-project endpoint, and every new
// project's stages come from the company's default_stages policy rather than
// an explicit type_ids list — pin that policy once, up front, so the fixture
// below still gets the "To Do"/"Doing"/"Done" names these screens assert on.
const DEFAULT_STAGES = [
  { name: 'To Do', fold: false },
  { name: 'Doing', fold: false },
  { name: 'Review', fold: false },
  { name: 'Done', fold: true },
]

test.beforeAll(async ({ request }) => {
  const login = await request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })
  if (login.status() !== 200) throw new Error(`admin login failed in beforeAll: ${login.status()}`)
  const patched = await request.patch('/api/v1/settings/projects', { data: { default_stages: DEFAULT_STAGES } })
  if (patched.status() !== 200) throw new Error(`settings patch failed in beforeAll: ${patched.status()}`)
})

async function login(page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  // Login lands on the first section the user may open (accessPolicy.firstAllowedPath).
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
}

async function createProjectWithStages(page, name: string) {
  const res = await page.request.post('/api/v1/projects', { data: { name, date_end: '2035-12-31' } })
  const body = await res.json()
  return body.id as number
}

async function dragCard(page, fromLocator, toLocator) {
  await fromLocator.scrollIntoViewIfNeeded()
  const from = await fromLocator.boundingBox()
  const to = await toLocator.boundingBox()
  if (!from || !to) throw new Error('missing bounding box for drag')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  const targetX = to.x + to.width / 2
  const targetY = to.y + Math.min(40, to.height / 2)
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from.x + from.width / 2 + ((targetX - (from.x + from.width / 2)) * i) / 10, from.y + from.height / 2 + ((targetY - (from.y + from.height / 2)) * i) / 10)
    await page.waitForTimeout(20)
  }
  await page.mouse.up()
}

test('projects table shows status and progress, and a row opens the project', async ({ page }) => {
  await login(page)
  const name = `E2E project ${Date.now()}`
  const id = await createProjectWithStages(page, name)
  await page.request.post(`/api/v1/projects/${id}/status`, { data: { status: 'at_risk' } })
  const a = (await (await page.request.post('/api/v1/tasks', { data: { name: `${name} a`, project_id: id } })).json()).id
  await page.request.post('/api/v1/tasks', { data: { name: `${name} b`, project_id: id } })
  await page.request.post(`/api/v1/tasks/${a}/transition`, { data: { state: 'done' } })

  await page.goto('/projects?view=table')
  await expect(page.getByRole('heading', { name: 'المشاريع' })).toBeVisible()
  const search = page.getByPlaceholder('ابحث باسم المشروع…')
  await expect(search).toBeEnabled()
  await search.fill(name)
  const row = page.getByTestId('project-row').filter({ hasText: name })
  await expect(row).toBeVisible()
  await expect(row.getByTestId('project-status')).toHaveText('معرض للخطر')
  await expect(row.getByTestId('project-progress')).toHaveText('50%')
  await expect(row.getByRole('link', { name })).toHaveAttribute('href', new RegExp(`/projects/${id}\\?returnTo=`))
  await page.getByTestId('projects-status-filter').click()
  await page.getByRole('option', { name: 'معرض للخطر', exact: true }).click()
  await expect(row).toBeVisible()
  await expect(page).toHaveURL((url) => url.searchParams.get('status') === 'at_risk' && url.searchParams.get('q') === name)
  await page.reload()
  await expect(row).toBeVisible()
  await expect(page).toHaveURL((url) => url.searchParams.get('status') === 'at_risk' && url.searchParams.get('q') === name)
  await row.click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}\\?returnTo=`))
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await page.getByRole('link', { name: 'العودة إلى المشاريع' }).click()
  await expect(page).toHaveURL((url) => (
    url.pathname === '/projects'
    && url.searchParams.get('status') === 'at_risk'
    && url.searchParams.get('q') === name
  ))
  await expect(page.getByTestId('project-row').filter({ hasText: name })).toBeVisible()
})

test('overlapping search and status updates keep both filters in the URL', async ({ page }) => {
  await login(page)
  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'المشاريع' })).toBeVisible()
  const search = page.getByPlaceholder('ابحث باسم المشروع…')
  await expect(search).toBeEnabled()
  await search.fill('RapidQ')
  await page.getByTestId('projects-status-filter').click()
  await page.getByRole('option', { name: 'على المسار', exact: true }).click()
  await expect(page).toHaveURL((url) => url.searchParams.get('q') === 'RapidQ' && url.searchParams.get('status') === 'on_track')
  expect(projectListParams(page).get('q')).toBe('RapidQ')
  expect(projectListParams(page).get('status')).toBe('on_track')
})

test('project list result count follows filtered records', async ({ page }) => {
  await login(page)
  const name = `E2E summary ${Date.now()}`
  const id = await createProjectWithStages(page, name)
  await page.request.post(`/api/v1/projects/${id}/status`, { data: { status: 'at_risk' } })

  await page.goto(`/projects?q=${encodeURIComponent(name)}`)
  await expect(page.getByTestId('projects-result-count')).toContainText('1')
})

test('project list shows every task of the project (not only mine), the detail page returns to the project', async ({ page }) => {
  await login(page)
  const name = `E2E plist ${Date.now()}`
  const id = await createProjectWithStages(page, name)
  const t = (await (await page.request.post('/api/v1/tasks', { data: { name: `${name} task`, project_id: id } })).json()).id
  // Unassign admin: the task must still be listed on the project screen.
  await page.request.patch(`/api/v1/tasks/${t}`, { data: { user_ids: [] } })

  await page.goto(`/projects/${id}?tab=list&q=${encodeURIComponent(name)}`)
  const row = page.getByRole('row', { name: new RegExp(`${name} task`) })
  await expect(row).toBeVisible()
  await expect(row.getByText('To Do')).toBeVisible()
  await row.click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/tasks/${t}\\?`))
  await expect(page.locator('h1')).toHaveText(`${name} task`)
  await page.keyboard.press('Escape')
  // vue-router serialises the query with URLSearchParams semantics (spaces as
  // '+'), so build the expected value the same way rather than with
  // encodeURIComponent ('%20'), and regex-escape it.
  const q = new URLSearchParams({ q: name }).toString().slice(2).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  await expect(page).toHaveURL(new RegExp(`/projects/${id}\\?tab=list&q=${q}$`))
})

test('project board groups by project stage, and a drag persists', async ({ page }) => {
  await login(page)
  const name = `E2E pboard ${Date.now()}`
  const id = await createProjectWithStages(page, name)
  const t = (await (await page.request.post('/api/v1/tasks', { data: { name: `${name} card`, project_id: id } })).json()).id

  await page.goto(`/projects/${id}?tab=board`)
  const columns = page.getByTestId('board-column')
  await expect(columns.filter({ hasText: 'To Do' })).toBeVisible()
  await expect(columns.filter({ hasText: 'To Do' }).getByTestId(`board-card-${t}`)).toBeVisible()
  const doing = columns.filter({ hasText: 'Doing' })
  await dragCard(page, page.getByTestId(`board-card-${t}`), doing)
  await expect(doing.getByTestId(`board-card-${t}`)).toBeVisible({ timeout: 10_000 })
  await page.reload()
  await expect(page.getByTestId('board-column').filter({ hasText: 'Doing' }).getByTestId(`board-card-${t}`)).toBeVisible({ timeout: 10_000 })
  // Folded "Done" renders collapsed.
  await expect(page.getByTestId('board-column-folded')).toBeVisible()
})

test('project task routes preserve the explicit board tab and filters', async ({ page }) => {
  await login(page)
  const name = `E2E board return ${Date.now()}`
  const id = await createProjectWithStages(page, name)
  const taskName = `${name} task`
  const task = (await (await page.request.post('/api/v1/tasks', { data: { name: taskName, project_id: id } })).json()).id as number
  const returnPath = `/projects/${id}?${new URLSearchParams({ tab: 'board', q: name })}`

  await page.goto(returnPath)
  await expect(page.getByTestId(`board-card-${task}`)).toBeVisible()
  await page.getByTestId(`board-card-${task}`).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/tasks/${task}\\?`))
  await expect.poll(() => new URL(page.url()).searchParams.get('returnTo')).toBe(returnPath)
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(returnPath)
})

test('project primary action and contextual settings remain accessible across font sizes', async ({ page, context }) => {
  await login(page)
  const id = await createProjectWithStages(page, `E2E header actions ${Date.now()}`)
  await page.goto(`/projects/${id}/tasks`)

  const hostname = new URL(page.url()).hostname
  for (const fontSize of ['small', 'large'] as const) {
    await context.addCookies([{
      name: 'webvue-appearance',
      value: encodeURIComponent(JSON.stringify({ mode: 'light', fontSize })),
      domain: hostname,
      path: '/',
    }])
    await page.reload()
    for (const testId of ['project-header-create', 'project-workspace-settings']) {
      const action = page.getByTestId(testId)
      await expect(action).toBeVisible()
      const box = await action.boundingBox()
      expect(box?.width).toBeGreaterThanOrEqual(32)
      expect(box?.height).toBeGreaterThanOrEqual(32)
    }
  }
})

test('project task creation preserves the explicit board tab and filters', async ({ page }) => {
  await login(page)
  const id = await createProjectWithStages(page, `E2E create return ${Date.now()}`)
  const returnPath = `/projects/${id}?tab=board&q=return-check`

  await page.goto(returnPath)
  await page.getByTestId('project-header-create').click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/tasks/new\\?`))
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'مهمة جديدة' })).toBeVisible()
  await page.getByRole('button', { name: 'إلغاء' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/tasks`))
})

test('create task from the project locks the project, and a manager sets the status', async ({ page }) => {
  await login(page)
  const name = `E2E pcreate ${Date.now()}`
  const id = await createProjectWithStages(page, name)

  await page.goto(`/projects/${id}/tasks`)
  await page.getByTestId('project-header-create').click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/tasks/new\\?returnTo=`))
  const form = page.getByTestId('task-create-form')
  await expect(form.getByText(name)).toBeVisible()
  await form.getByLabel('عنوان المهمة').fill(`${name} new`)
  await form.getByRole('button', { name: 'إنشاء' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/tasks/\\d+`))
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/tasks$`))

  await page.goto(`/projects/${id}`)
  await expect(page.getByTestId('project-overview').getByTestId('project-status-select')).toHaveCount(0)
  await page.goto(`/projects/${id}/settings`)
  await page.getByTestId('project-status-select').click()
  await page.getByRole('option', { name: 'خارج المسار' }).click()
  await expect(page.getByTestId('project-status-select')).toContainText('خارج المسار')
  await page.reload()
  await expect(page.getByTestId('project-status-select')).toContainText('خارج المسار')
})

function mockProject(id: number, name: string, status: 'on_track' | 'at_risk' | null = 'on_track') {
  return {
    id,
    name,
    status,
    progress: 0,
    task_count: 0,
    closed_task_count: 0,
    active: true,
    can_manage: true,
    allowed_actions: ['read', 'write', 'archive'],
  }
}

test('project list next/previous pages keep q, status, and offset in the URL', async ({ page }) => {
  await login(page)
  const total = 201
  await page.route('**/api/v1/projects**', async (route) => {
    const request = route.request()
    if (request.method() !== 'GET') {
      await route.continue()
      return
    }
    const url = new URL(request.url())
    if (!url.pathname.endsWith('/api/v1/projects')) {
      await route.continue()
      return
    }
    if (url.searchParams.get('minimal') === '1') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
      return
    }
    const limit = Math.max(1, Number(url.searchParams.get('limit') || '50') || 50)
    const offset = Math.max(0, Number(url.searchParams.get('offset') || '0') || 0)
    const items = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => {
      const id = offset + i + 1
      return mockProject(id, `Mock Bulk ${id}`, id % 10 === 0 ? 'at_risk' : 'on_track')
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items, total, can_create: true, can_list_archived: true }),
    })
  })

  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'المشاريع' })).toBeVisible()
  await page.getByPlaceholder('ابحث باسم المشروع…').fill('Bulk')
  await page.getByTestId('projects-status-filter').click()
  await page.getByRole('option', { name: 'على المسار', exact: true }).click()
  await expect(page).toHaveURL((url) => url.searchParams.get('q') === 'Bulk' && url.searchParams.get('status') === 'on_track')
  await expect(page.getByText('صفحة 1 من 5')).toBeVisible()
  await expect(page.getByTestId('projects-result-count')).toContainText('201')
  await page.getByRole('button', { name: 'التالي' }).click()
  await expect(page).toHaveURL((url) => (
    url.searchParams.get('q') === 'Bulk'
    && url.searchParams.get('status') === 'on_track'
    && url.searchParams.get('offset') === '50'
  ))
  await expect(page.getByText('صفحة 2 من 5')).toBeVisible()
  await expect(page.getByTestId('projects-result-count')).toContainText('201')
  await page.getByRole('button', { name: 'السابق' }).click()
  await expect(page).toHaveURL((url) => (
    url.searchParams.get('q') === 'Bulk'
    && url.searchParams.get('status') === 'on_track'
    && !url.searchParams.has('offset')
  ))
  await expect(page.getByText('صفحة 1 من 5')).toBeVisible()
  await expect(page.getByTestId('projects-result-count')).toContainText('201')
  expect(projectListParams(page).get('q')).toBe('Bulk')
  expect(projectListParams(page).get('status')).toBe('on_track')
})
