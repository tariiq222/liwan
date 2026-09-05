import { test, expect } from '@playwright/test'

// Every search row advertises a key; the keys have to actually navigate.
test('the ⌘K search page navigates with the shortcut it advertises', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page.getByRole('navigation')).toContainText('مهامي')
  // Focus a non-interactive heading; fixed coordinates can click a task row.
  await page.getByRole('heading', { name: 'مهامي' }).click()

  await page.keyboard.press('ControlOrMeta+k')
  await expect(page).toHaveURL(/\/search\?returnTo=/)
  await expect(page.getByPlaceholder('اكتب للانتقال…')).toBeVisible()

  await page.keyboard.press('2')
  await expect(page).toHaveURL(/\/projects$/)
})

// Once the user is filtering, the same characters must land in the search
// box instead of being hijacked as navigation shortcuts.
test('the search page receives shortcut characters once it has a query and survives reload', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page.getByRole('navigation')).toContainText('مهامي')
  // Focus a non-interactive heading; fixed coordinates can click a task row.
  await page.getByRole('heading', { name: 'مهامي' }).click()

  await page.keyboard.press('ControlOrMeta+k')
  const input = page.getByPlaceholder('اكتب للانتقال…')
  await expect(input).toBeVisible()

  await page.keyboard.type('x2')
  await expect(page).toHaveURL(/\/search\?returnTo=/)
  await expect(input).toHaveValue('x2')

  await page.reload()
  await expect(page.getByTestId('search-page')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
