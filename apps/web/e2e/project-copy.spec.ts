import { expect, test, type Page } from '@playwright/test'

// Opt-in local UI fixture only: shares the isolated PROJECTS_UI_PREVIEW mock server with project-popups.
test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Requires isolated PROJECTS_UI_PREVIEW mock server')
test.describe.configure({ timeout: 45_000 })

async function login(page: Page) {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.beforeEach(async ({ page }) => { await login(page) })

test('copying a project from its summary opens the create panel and lands on the new project', async ({ page }) => {
  await page.goto('/projects/1')
  await page.getByTestId('project-copy-link').click()
  await expect(page).toHaveURL(url => url.pathname === '/projects/new' && url.searchParams.get('copyFrom') === '1')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  const form = page.getByTestId('project-copy-form')
  await expect(form).toBeVisible()
  await expect(page.getByTestId('project-copy-source')).toHaveValue('مشروع ألفا')
  await expect(page.getByTestId('project-copy-name')).toHaveValue('مشروع ألفا (نسخة)')
  await expect(page.getByTestId('project-create-form')).toHaveCount(0)

  const name = 'مشروع ألفا - الدفعة الثانية'
  await page.getByTestId('project-copy-name').fill(name)
  const request = page.waitForRequest(r => r.method() === 'POST' && new URL(r.url()).pathname === '/api/v1/projects/1/copy')
  await page.getByTestId('project-copy-submit').click()
  const body = (await request).postDataJSON()
  expect(body.name).toBe(name)
  expect(body.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)

  await expect(page).toHaveURL(url => /^\/projects\/\d+$/.test(url.pathname) && url.pathname !== '/projects/1')
  await expect(page.getByTestId('project-workspace-name')).toHaveText(name)
  await page.reload()
  await expect(page.getByTestId('project-workspace-name')).toHaveText(name)
})

test('a blank name is refused inline before any request is sent', async ({ page }) => {
  await page.goto('/projects/new?copyFrom=1')
  await page.getByTestId('project-copy-name').fill('   ')
  let posted = false
  page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/copy')) posted = true })
  await page.getByTestId('project-copy-submit').click()
  await expect(page.getByText('أدخل اسم المشروع الجديد', { exact: false })).toBeVisible()
  expect(posted).toBe(false)
})

test('a malformed copyFrom falls back to the ordinary create form', async ({ page }) => {
  await page.goto('/projects/new?copyFrom=abc')
  await expect(page.getByTestId('project-copy-form')).toHaveCount(0)
  await expect(page.getByTestId('project-create-form')).toBeVisible()
})
