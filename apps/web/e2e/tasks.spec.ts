import { test, expect } from '@playwright/test'
async function login(page) { await page.goto('/login'); await page.getByLabel('اسم المستخدم').fill('admin'); await page.getByLabel('كلمة المرور').fill('admin'); await page.getByRole('button', { name: 'دخول' }).click(); await expect(page).toHaveURL('http://localhost:3000/') }
test('my tasks table lists my open tasks, filters and opens the drawer', async ({ page }) => {
  await login(page)
  const projects = await (await page.request.get('/api/v1/projects?minimal=1')).json()
  const name = `E2E table ${Date.now()}`
  await page.request.post('/api/v1/tasks', { data: { name, project_id: projects[0].id } })
  await page.goto('/tasks')
  await expect(page.getByRole('heading', { name: 'مهامي' })).toBeVisible()
  const row = page.getByRole('row', { name: new RegExp(name) })
  await expect(row).toBeVisible()
  await expect(row.getByText('قيد التنفيذ')).toBeVisible()
  await page.getByPlaceholder('بحث في العناوين…').fill('zzz-no-such-task')
  await expect(page.getByText('لا نتائج.')).toBeVisible()
  await page.getByPlaceholder('بحث في العناوين…').fill(name)
  await row.click()
  await expect(page).toHaveURL(new RegExp('/tasks\\?.*task=\\d+'))
  await expect(page.getByRole('dialog')).toContainText(name)
})
test('inline transition to done moves the task to the closed filter', async ({ page }) => {
  await login(page)
  const projects = await (await page.request.get('/api/v1/projects?minimal=1')).json()
  const name = `E2E done ${Date.now()}`
  await page.request.post('/api/v1/tasks', { data: { name, project_id: projects[0].id } })
  await page.goto('/tasks')
  const row = page.getByRole('row', { name: new RegExp(name) })
  await row.getByRole('button', { name: 'قيد التنفيذ' }).click()
  await page.getByRole('menuitem', { name: 'منجز' }).click()
  await expect(row).toBeHidden()
  await page.getByRole('tab', { name: 'منجزة' }).click()
  await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible()
})
