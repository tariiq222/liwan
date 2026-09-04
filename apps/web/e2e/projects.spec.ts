import { test, expect } from '@playwright/test'

async function login(page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).toHaveURL('http://localhost:3000/')
}

// There is no create-project endpoint in phase 2; fixtures go through Odoo's
// own RPC with the same session cookie (same origin, /web/* is proxied).
async function callKw(page, model: string, method: string, args: unknown[]) {
  const res = await page.request.post(`/web/dataset/call_kw/${model}/${method}`, {
    data: { jsonrpc: '2.0', method: 'call', params: { model, method, args, kwargs: {} } },
  })
  const body = await res.json()
  if (body.error) throw new Error(JSON.stringify(body.error.data?.message ?? body.error))
  return body.result
}

async function createProjectWithStages(page, name: string) {
  const id = await callKw(page, 'project.project', 'create', [{
    name,
    type_ids: [[0, 0, { name: 'To Do', sequence: 1 }], [0, 0, { name: 'Doing', sequence: 2 }], [0, 0, { name: 'Done', sequence: 3, fold: true }]],
  }])
  return id as number
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
  await row.click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}$`))
  await expect(page.getByRole('heading', { name })).toBeVisible()
})

test('project list shows every task of the project (not only mine), the modal closes back to the project', async ({ page }) => {
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
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'عنوان المهمة' })).toHaveValue(`${name} task`)
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(new RegExp(`/projects/${id}\\?tab=list&q=`))
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
  await page.getByRole('button', { name: 'مهمة جديدة' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(name)).toBeVisible()
  await dialog.getByLabel('عنوان المهمة').fill(`${name} new`)
  await dialog.getByRole('button', { name: 'إنشاء' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/tasks/\\d+`))
  await page.keyboard.press('Escape')

  await page.getByTestId('project-status-select').click()
  await page.getByRole('option', { name: 'خارج المسار' }).click()
  await expect(page.getByTestId('project-status-select')).toContainText('خارج المسار')
  await page.reload()
  await expect(page.getByTestId('project-status-select')).toContainText('خارج المسار')
})
