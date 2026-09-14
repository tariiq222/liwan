import { test, expect, type Page } from '@playwright/test'

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  // Login lands on the first section the user may open (accessPolicy.firstAllowedPath).
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
}

test('search opens centered, searches real tasks, closes with Escape and navigates a result', async ({ page }) => {
  await login(page)
  const project = await (await page.request.post('/api/v1/projects', { data: { name: `Popup project ${Date.now()}`, date_end: '2035-12-31' } })).json()
  const task = await (await page.request.post('/api/v1/tasks', { data: { name: `Popup task ${Date.now()}`, project_id: project.id } })).json()
  await page.goto('/tasks?q=kept-search&sort=deadline')
  await page.getByRole('button', { name: 'بحث', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'بحث', exact: true })
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(/\/tasks\?q=kept-search&sort=deadline$/)
  const input = dialog.getByRole('textbox')
  await expect(input).toBeFocused()
  await input.fill(task.name)
  await expect(dialog.getByRole('link', { name: task.name, exact: true })).toBeVisible()
  const box = await dialog.boundingBox()
  const viewport = page.viewportSize()!
  expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThan(3)
  expect(Math.abs(box!.y + box!.height / 2 - viewport.height / 2)).toBeLessThan(3)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'بحث', exact: true })).toBeFocused()
  await page.keyboard.press('Control+k')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox').fill(task.name)
  await dialog.getByRole('link', { name: task.name, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}\\?returnTo=`))
  await expect(dialog).toBeHidden()
  await page.getByRole('link', { name: 'العودة إلى المهام', exact: true }).click()
  await expect(page).toHaveURL(/\/tasks\?q=kept-search&sort=deadline$/)
})

test('bell preview routes a digest item to the digest page instead of a task id', async ({ page }) => {
  await page.route('**/api/v1/notifications?*', route => route.fulfill({
    json: {
      items: [
        {
          id: 501, kind: 'overdue_digest', digest_id: 501, overdue_count: 2, local_date: '2026-09-06',
          body: 'ملخص المتأخرات', created_at: '2026-09-06T12:00:00', is_read: false,
        },
        { id: 502, kind: 'comment', task_id: 77, task_name: 'Task comment', body: 'hi', created_at: '2026-09-06T12:00:00', is_read: true },
      ],
      total: 2,
      unread_count: 1,
    },
  }))
  await page.route('**/api/v1/notifications/501/read', route => route.fulfill({ json: { updated: 1 } }))
  await login(page)
  await page.getByTestId('notification-bell').click()
  await page.getByTestId('notification-preview-501').click()
  await expect(page).toHaveURL(/\/notification-digests\/501/)
  await expect(page).not.toHaveURL(/\/tasks\/undefined/)
})

test('bell previews latest five and More opens the full notification page', async ({ page }) => {
  // Deterministic notification history verifies the preview cap independently of recipient events.
  const items = Array.from({ length: 8 }, (_, i) => ({ id: 108 - i, kind: 'comment', task_id: 2, task_name: `Notification ${8 - i}`, body: 'Preview body', created_at: '2026-09-06T12:00:00', is_read: false }))
  await page.route('**/api/v1/notifications?*', route => route.fulfill({ json: { items, total: 8, unread_count: 8 } }))
  await login(page)
  await page.getByTestId('notification-bell').click()
  await expect(page).toHaveURL(/\/tasks$/)
  const preview = page.getByTestId('notification-preview')
  await expect(preview).toBeVisible()
  await expect(preview.locator('[data-notification-preview-item]')).toHaveCount(5)
  await expect(preview.getByText('Notification 8', { exact: true })).toBeVisible()
  await expect(preview.getByText('Notification 3', { exact: true })).toHaveCount(0)
  await preview.getByRole('link', { name: 'المزيد', exact: true }).click()
  await expect(page).toHaveURL(/\/notifications$/)
  await expect(page.getByTestId('notification-center').getByText('Notification 8', { exact: true })).toBeVisible()
})

test('notification preview keeps a failed read open and opens the task after retry', async ({ page: setupPage, browser }) => {
  await login(setupPage)
  const project = await (await setupPage.request.post('/api/v1/projects', { data: { name: `Notification preview ${Date.now()}`, date_end: '2035-12-31' } })).json()
  const task = await (await setupPage.request.post('/api/v1/tasks', { data: { name: 'مهمة من قائمة الإشعارات', project_id: project.id } })).json()
  const page = await browser.newPage({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000' })
  await page.route('**/api/v1/notifications?*', route => route.fulfill({ json: { items: [{ id: 901, kind: 'comment', task_id: task.id, task_name: task.name, body: 'تعليق تجريبي', created_at: '2026-09-06T12:00:00', is_read: false }], total: 1, unread_count: 1 } }))
  let failRead = true
  await page.route('**/api/v1/notifications/901/read', route => route.fulfill(failRead ? { status: 500, json: { code: 'server_error', message: 'تعذر تحديث الإشعار' } } : { json: { updated: 1 } }))
  await login(page)
  await page.getByTestId('notification-bell').click()
  await page.getByTestId('notification-preview-901').click()
  await expect(page.getByTestId('notification-preview')).toBeVisible()
  await expect(page).toHaveURL(/\/tasks$/)
  await expect(page.getByTestId('notification-preview-901')).toBeEnabled()
  failRead = false
  await page.getByTestId('notification-preview-901').click()
  await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`))
  await expect(page.locator('h1')).toHaveText(task.name)
  await page.close()
})

test('overlays fit mobile dark mode with large text and search handles no results', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)
  await page.goto('/settings/appearance')
  await page.getByTestId('appearance-font-large').check()
  await page.getByTestId('appearance-mode-dark').check()
  await page.getByRole('button', { name: 'بحث', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'بحث', exact: true })
  await dialog.getByRole('textbox').fill('zzzero-result-unmatchable-098765')
  await expect(dialog.getByText('لا نتائج.', { exact: true })).toBeVisible()
  const box = await dialog.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  expect(box!.height).toBeLessThanOrEqual(844)
  await expect(dialog).toHaveCSS('opacity', '1')
  await page.screenshot({ path: testInfo.outputPath('search-mobile-dark.png') })
  await page.keyboard.press('Escape')
  await page.getByTestId('notification-bell').click()
  const preview = page.getByTestId('notification-preview')
  await expect(preview.getByRole('link', { name: 'المزيد', exact: true })).toBeVisible()
  const previewBox = await preview.boundingBox()
  expect(previewBox!.x).toBeGreaterThanOrEqual(0)
  expect(previewBox!.x + previewBox!.width).toBeLessThanOrEqual(390)
  await expect(preview).toHaveCSS('opacity', '1')
  await page.screenshot({ path: testInfo.outputPath('notifications-mobile-dark.png') })
})
