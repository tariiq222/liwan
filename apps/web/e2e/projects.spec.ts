import { test, expect } from '@playwright/test'

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
  await expect(page).toHaveURL(/\/tasks$/)
}

async function createProjectWithStages(page, name: string) {
  const res = await page.request.post('/api/v1/projects', { data: { name } })
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

  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'المشاريع' })).toBeVisible()
  const row = page.getByTestId('project-row').filter({ hasText: name })
  await expect(row.getByTestId('project-status')).toHaveText('معرض للخطر')
  await expect(row.getByTestId('project-progress')).toHaveText('50%')
  await page.getByPlaceholder('ابحث باسم المشروع…').fill(name)
  await expect(row).toBeVisible()
  await page.getByRole('combobox').click()
  await page.getByRole('option', { name: 'معرض للخطر' }).click()
  await expect(row).toBeVisible()
  await expect(page).toHaveURL(new RegExp('status=at_risk'))
  await row.click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}\\?returnTo=`))
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await page.getByRole('link', { name: 'العودة إلى المشاريع' }).click()
  await expect(page).toHaveURL(/\/projects\?status=at_risk&q=/)
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
  await expect(page.getByTestId('task-detail-page').getByRole('textbox', { name: 'عنوان المهمة' })).toHaveValue(`${name} task`)
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

test('create task from the project locks the project, and a manager sets the status', async ({ page }) => {
  await login(page)
  const name = `E2E pcreate ${Date.now()}`
  const id = await createProjectWithStages(page, name)

  await page.goto(`/projects/${id}`)
  await page.getByRole('button', { name: 'مهمة جديدة' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/tasks/new\\?returnTo=`))
  const form = page.getByTestId('task-create-form')
  await expect(form.getByText(name)).toBeVisible()
  await form.getByLabel('عنوان المهمة').fill(`${name} new`)
  await form.getByRole('button', { name: 'إنشاء' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/tasks/\\d+`))
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(new RegExp(`/projects/${id}$`))

  await page.getByTestId('project-status-select').click()
  await page.getByRole('option', { name: 'خارج المسار' }).click()
  await expect(page.getByTestId('project-status-select')).toContainText('خارج المسار')
  await page.reload()
  await expect(page.getByTestId('project-status-select')).toContainText('خارج المسار')
})
