import { test, expect } from '@playwright/test'

async function login(page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
}

async function createTask(page, name: string) {
  const projectsRes = await page.request.get('/api/v1/projects?minimal=1')
  expect(projectsRes.ok()).toBe(true)
  const projects = await projectsRes.json()
  let projectId = projects[0]?.id as number | undefined
  if (!projectId) {
    const projectRes = await page.request.post('/api/v1/projects', { data: { name: `E2E activity project ${Date.now()}` } })
    expect(projectRes.status()).toBe(201)
    projectId = (await projectRes.json()).id as number
  }
  const res = await page.request.post('/api/v1/tasks', { data: { name, project_id: projectId } })
  expect(res.status()).toBe(201)
  return (await res.json()).id as number
}

test('task activity: post a comment and see a tracking entry after a state change', async ({ page }) => {
  await login(page)
  const name = `E2E activity ${Date.now()}`
  const id = await createTask(page, name)

  await page.goto(`/tasks/${id}`)
  const detail = page.getByTestId('task-detail-page')
  await expect(detail).toBeVisible()
  // wait for the client-rendered detail body before interacting (SSR hydration race)
  await expect(detail.getByRole('textbox', { name: 'عنوان المهمة' })).toHaveValue(name)

  const composer = detail.getByPlaceholder('اكتب تعليقًا…')
  await expect(composer).toBeVisible()
  const commentText = `تعليق تجريبي ${Date.now()}`
  await composer.fill(commentText)
  const commentPosted = page.waitForResponse((r) => r.url().includes(`/api/v1/tasks/${id}/comments`) && r.request().method() === 'POST')
  await composer.press('Control+Enter')
  await commentPosted
  await expect(composer).toHaveValue('')

  const timeline = detail.getByRole('list').first()
  const firstEntry = timeline.locator('li').first()
  await expect(firstEntry).toContainText(commentText)
  await expect(firstEntry).toContainText('Administrator')

  // change state via the header menu -> expect a tracking entry mentioning "الحالة"
  const stateTrigger = detail.getByRole('button').filter({ hasText: /قيد التنفيذ|بانتظار|تعديلات مطلوبة|معتمد|منجز|ملغى/ }).first()
  await stateTrigger.click()
  const transitioned = page.waitForResponse((r) => r.url().includes(`/api/v1/tasks/${id}/transition`) && r.request().method() === 'POST')
  await page.getByRole('menuitem').first().click()
  const transitionResponse = await transitioned
  expect(transitionResponse.status()).toBe(200)
  await transitionResponse.finished()
  // Odoo localizes tracking labels using the authenticated user's language;
  // the same state-change entry is therefore "الحالة" or "State".
  await expect(detail.locator('li').filter({ hasText: /الحالة|State/ }).first()).toBeVisible()
})
