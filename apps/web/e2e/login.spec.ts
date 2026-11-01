import { test, expect } from '@playwright/test'

test('wrong password stays on /login with an error', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('definitely-wrong')
  const authenticated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'دخول' }).click()
  expect((await authenticated).status()).toBe(401)
  await expect(page.getByText('بيانات الدخول غير صحيحة')).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
})

test('admin logs in and lands on the app shell', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  const authenticated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'دخول' }).click()
  expect((await authenticated).status()).toBe(200)
  // Login lands on the first section the user may open (accessPolicy.firstAllowedPath).
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
  await expect(page.getByTestId('module-rail').getByRole('link', { name: 'المشاريع', exact: true })).toHaveAttribute('href', '/projects')
  await expect(page.getByTestId('module-rail').getByRole('link', { name: 'مهامي', exact: true })).toHaveAttribute('href', '/my-tasks')
})
