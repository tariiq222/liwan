import { test, expect } from '@playwright/test'
import { ACCEPTANCE_ORIGIN, signIn } from './support/realOdooSession'

// Runs only on the isolated real-Odoo stack (deploy/ci/e2e-odoo.sh).
test.skip(process.env.E2E_REAL_ODOO !== '1', 'Explicit isolated real Odoo acceptance only')
test.beforeEach(async ({}, info) => { expect(new URL(String(info.project.use.baseURL)).origin).toBe(ACCEPTANCE_ORIGIN) })

async function createTask(page, name: string) {
  const projects = await (await page.request.get('/api/v1/projects?minimal=1')).json()
  const res = await page.request.post('/api/v1/tasks', { data: { name, project_id: projects[0].id } })
  return (await res.json()).id as number
}

test('task activity: post a comment and see a tracking entry after a state change', async ({ page }) => {
  await signIn(page)
  const currentUser = await (await page.request.get('/api/v1/me')).json()
  const name = `E2E activity ${Date.now()}`
  const id = await createTask(page, name)

  await page.goto(`/tasks/${id}`)
  const detail = page.getByTestId('task-detail-page')
  await expect(detail).toBeVisible()
  // wait for the client-rendered detail body before interacting (SSR hydration race)
  await expect(page.locator('h1')).toHaveText(name)

  const activity = page.getByTestId('task-activity')
  const filter = page.getByTestId('task-activity-filter')
  await filter.getByRole('button', { name: 'التعليقات', exact: true }).click()
  const composer = activity.getByPlaceholder(/^اكتب تعليقًا…/)
  await expect(composer).toBeVisible()
  const commentText = `تعليق تجريبي ${Date.now()}`
  await composer.fill(commentText)
  const commentPosted = page.waitForResponse((r) => r.url().includes(`/api/v1/tasks/${id}/comments`) && r.request().method() === 'POST')
  await composer.press('Control+Enter')
  await commentPosted
  await expect(composer).toHaveValue('')

  // The feed runs oldest first, so the new comment is the last entry.
  const timeline = activity.getByTestId('task-activity-feed')
  const firstEntry = timeline.locator('li').last()
  await expect(firstEntry).toContainText(commentText)
  await expect(firstEntry).toContainText(currentUser.name)

  // change state via the header menu -> expect a tracking entry mentioning "الحالة"
  const stateTrigger = detail.getByRole('button').filter({ hasText: /قيد التنفيذ|بانتظار|تعديلات مطلوبة|معتمد|منجز|ملغى/ }).first()
  await stateTrigger.click()
  const transitioned = page.waitForResponse((r) => r.url().includes(`/api/v1/tasks/${id}/transition`) && r.request().method() === 'POST')
  await page.getByRole('menuitem').first().click()
  await transitioned
  // Fresh isolated Odoo databases may retain the stock English field label.
  await filter.getByRole('button', { name: 'السجل', exact: true }).click()
  const log = activity.getByTestId('task-activity-feed')
  await expect(log.locator('li').filter({ hasText: /الحالة|State/ }).first()).toBeVisible()
  await expect(log).not.toContainText(commentText)
})
