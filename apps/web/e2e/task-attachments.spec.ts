import { test, expect } from '@playwright/test'

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
  const response = await page.request.post('/api/v1/tasks', { data: { name, project_id: projects[0].id } })
  expect(response.status()).toBe(201)
  return (await response.json()).id as number
}

test('task attachments upload, download real bytes, delete, and reload', async ({ page }) => {
  await login(page)
  const taskId = await createTask(page, `E2E attachment ${Date.now()}`)
  await page.goto(`/tasks/${taskId}`)

  await page.getByTestId('task-detail-tabs').getByRole('tab', { name: 'المرفقات', exact: true }).click()
  const section = page.getByTestId('task-attachments')
  await expect(section).toBeVisible()
  const filename = `e2e-${Date.now()}.pdf`
  const content = Buffer.from('%PDF-1.7\nreal attachment bytes\n')
  const uploaded = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/tasks/${taskId}/attachments`) && response.request().method() === 'POST',
  )
  await expect(section.getByLabel('رفع ملف')).toBeEnabled()
  await section.locator('input[type="file"]').setInputFiles({ name: filename, mimeType: 'application/pdf', buffer: content })
  expect((await uploaded).status()).toBe(201)
  const link = section.getByRole('link', { name: filename })
  await expect(link).toBeVisible()

  const href = await link.getAttribute('href')
  expect(href).toContain('/web/content/')
  const downloaded = await page.request.get(href!)
  expect(downloaded.status()).toBe(200)
  expect(await downloaded.body()).toEqual(content)

  // Destructive confirmation stays inline, so cancel is testable without an overlay.
  await section.getByRole('button', { name: 'حذف المرفق' }).click()
  await expect(section.getByRole('group', { name: 'حذف هذا المرفق؟' })).toBeVisible()
  await section.getByRole('button', { name: 'إلغاء' }).click()
  await expect(link).toBeVisible()

  await section.getByRole('button', { name: 'حذف المرفق' }).click()
  const deleted = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/tasks/${taskId}/attachments/`) && response.request().method() === 'DELETE',
  )
  await section.getByRole('button', { name: 'تأكيد الحذف' }).click()
  expect((await deleted).status()).toBe(204)
  await expect(link).toHaveCount(0)
  await page.reload()
  await page.getByTestId('task-detail-tabs').getByRole('tab', { name: 'المرفقات', exact: true }).click()
  await expect(section).toBeVisible()
  await expect(page.getByTestId('task-attachments').getByRole('link', { name: filename })).toHaveCount(0)
})

