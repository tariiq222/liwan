import { test, expect } from '@playwright/test'

// Needs a real Odoo: it logs in as admin and writes data, which the mock answers with 404. It is in no CI list until it has run on a
// scratch Odoo (see docs/testing.md, section 3).
test.skip(process.env.E2E_REAL_ODOO !== '1', 'Explicit isolated real Odoo acceptance only')

async function login(page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  // Login lands on the first section the user may open (accessPolicy.firstAllowedPath).
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
}

async function createTask(page, name: string) {
  const projects = await (await page.request.get('/api/v1/projects?minimal=1')).json()
  const res = await page.request.post('/api/v1/tasks', { data: { name, project_id: projects[0].id } })
  return (await res.json()).id as number
}

test('task activity: post a comment and see a tracking entry after a state change', async ({ page }) => {
  await login(page)
  const currentUser = await (await page.request.get('/api/v1/me')).json()
  const name = `E2E activity ${Date.now()}`
  const id = await createTask(page, name)

  await page.goto(`/tasks/${id}`)
  const detail = page.getByTestId('task-detail-page')
  await expect(detail).toBeVisible()
  // wait for the client-rendered detail body before interacting (SSR hydration race)
  await expect(page.locator('h1')).toHaveText(name)

  const tabs = page.getByTestId('task-detail-tabs')
  await tabs.getByRole('tab', { name: 'التعليقات', exact: true }).click()
  const comments = page.getByTestId('task-comments-card')
  const composer = comments.getByPlaceholder('اكتب تعليقًا…')
  await expect(composer).toBeVisible()
  const commentText = `تعليق تجريبي ${Date.now()}`
  await composer.fill(commentText)
  const commentPosted = page.waitForResponse((r) => r.url().includes(`/api/v1/tasks/${id}/comments`) && r.request().method() === 'POST')
  await composer.press('Control+Enter')
  await commentPosted
  await expect(composer).toHaveValue('')

  const timeline = comments.getByRole('list').first()
  const firstEntry = timeline.locator('li').first()
  await expect(firstEntry).toContainText(commentText)
  await expect(firstEntry).toContainText(currentUser.name)

  // change state via the header menu -> expect a tracking entry mentioning "الحالة"
  const stateTrigger = detail.getByRole('button').filter({ hasText: /قيد التنفيذ|بانتظار|تعديلات مطلوبة|معتمد|منجز|ملغى/ }).first()
  await stateTrigger.click()
  const transitioned = page.waitForResponse((r) => r.url().includes(`/api/v1/tasks/${id}/transition`) && r.request().method() === 'POST')
  await page.getByRole('menuitem').first().click()
  await transitioned
  // Fresh isolated Odoo databases may retain the stock English field label.
  await tabs.getByRole('tab', { name: 'السجل', exact: true }).click()
  const log = page.getByTestId('task-activity-card')
  await expect(log.locator('li').filter({ hasText: /الحالة|State/ }).first()).toBeVisible()
  await expect(log.getByPlaceholder('اكتب تعليقًا…')).toHaveCount(0)
})
