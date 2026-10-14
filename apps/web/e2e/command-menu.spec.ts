import { test, expect } from '@playwright/test'

// ⌘K advertises the header search popup; it must open in place and the
// listed destinations must be real links, not a /search route change.
test('the ⌘K search dialog navigates with the shortcut it advertises', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  const authenticated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'دخول' }).click()
  expect((await authenticated).status()).toBe(200)
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
  await page.goto('/tasks')
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
  // Focus a non-interactive heading; fixed coordinates can click a task row.
  await page.getByRole('heading', { name: 'مهامي' }).click()

  await page.keyboard.press('ControlOrMeta+k')
  await expect(page).toHaveURL(/\/tasks$/)
  const dialog = page.getByRole('dialog', { name: 'بحث', exact: true })
  await expect(dialog).toBeVisible()
  const input = dialog.getByRole('textbox', { name: 'بحث', exact: true })
  await expect(input).toBeFocused()
  await expect(input).toHaveAttribute('placeholder', 'ابحث في الصفحات والمشاريع والمهام…')

  await dialog.getByRole('option', { name: 'المشاريع', exact: true }).click()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(dialog).toBeHidden()
})

// Once the dialog has focus, the same characters must land in the search
// box instead of being hijacked as navigation shortcuts, and Escape closes.
test('the search dialog receives shortcut characters once it has a query and closes with Escape', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  const authenticated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'دخول' }).click()
  expect((await authenticated).status()).toBe(200)
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
  await page.goto('/tasks')
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
  // Focus a non-interactive heading; fixed coordinates can click a task row.
  await page.getByRole('heading', { name: 'مهامي' }).click()

  await page.keyboard.press('ControlOrMeta+k')
  const dialog = page.getByRole('dialog', { name: 'بحث', exact: true })
  const input = dialog.getByRole('textbox', { name: 'بحث', exact: true })
  await expect(input).toBeFocused()

  await page.keyboard.type('x2')
  await expect(page).toHaveURL(/\/tasks$/)
  await expect(input).toHaveValue('x2')
  await expect(page.getByTestId('search-page')).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/\/tasks$/)
})
