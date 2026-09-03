import { test, expect } from '@playwright/test'

test('wrong password stays on /login with an error', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('definitely-wrong')
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page.getByText('بيانات الدخول غير صحيحة')).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
})

test('admin logs in and lands on the app shell', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).toHaveURL('http://localhost:3000/')
  // Task 9 replaces this with the sidebar assertion
  await expect(page.getByText('nasq')).toBeVisible()
})
