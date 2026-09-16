import { expect, test, type Page } from '@playwright/test'

const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'

async function login(page: Page) {
  await page.goto('/login')
  const submit = page.getByRole('button', { name: 'دخول' })
  await expect(submit).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill(ADMIN_LOGIN)
  await page.getByLabel('كلمة المرور').fill(ADMIN_PASSWORD)
  await submit.click()
  await expect(page).toHaveURL(/\/tasks$/)
}

test('project settings links to both catalogs without a shared nav item', async ({ page }) => {
  await login(page)
  await page.goto('/projects/settings')
  await expect(page.getByRole('heading', { name: 'المشاريع', exact: true })).toBeVisible()
  await expect(page.getByTestId('catalog-types-link')).toBeVisible()
  await expect(page.getByTestId('catalog-units-link')).toBeVisible()
  await page.getByTestId('catalog-types-link').click()
  await expect(page).toHaveURL(/\/settings\/projects\/catalogs\/types/)
  await expect(page.getByRole('heading', { name: 'أنواع المشاريع' })).toBeVisible()
  await expect(page.getByText('تقني')).toBeVisible()
  await expect(page.getByText('تشغيلي')).toBeVisible()
  await expect(page.getByText('إنشائي')).toBeVisible()
  await expect(page.getByText('تطويري')).toBeVisible()
  await page.getByRole('link', { name: 'العودة إلى إعدادات المشاريع' }).click()
  await expect(page).toHaveURL(/\/settings\/projects/)
})

test('owning units can be created, renamed, ordered, and deleted when unused', async ({ page }) => {
  await login(page)
  const name = `E2E unit ${Date.now()}`
  await page.goto('/projects/settings/catalogs/owning-units')
  await page.getByRole('button', { name: 'إضافة' }).click()
  await expect(page).toHaveURL(/\/settings\/projects\/catalogs\/owning-units\/new/)
  await page.getByLabel('الاسم').fill(name)
  await page.getByLabel('الترتيب').fill('30')
  await page.getByRole('button', { name: 'إنشاء' }).click()
  await expect(page.getByText(name)).toBeVisible()
  const row = page.locator('li').filter({ hasText: name })
  await row.getByRole('button', { name: 'تعديل' }).click()
  await page.getByLabel('الاسم').fill(`${name} محدث`)
  await page.getByLabel('الترتيب').fill('40')
  await page.getByRole('button', { name: 'حفظ' }).click()
  await expect(page.getByText(`${name} محدث`)).toBeVisible()
  const updated = page.locator('li').filter({ hasText: `${name} محدث` })
  await updated.getByRole('button', { name: 'حذف' }).click()
  await expect(page.getByText(`حذف «${name} محدث»`)).toBeVisible()
  await page.getByRole('button', { name: 'حذف' }).last().click()
  await expect(page.getByText(`${name} محدث`)).toHaveCount(0)
})

test('catalog edit departure is guarded while preserving the draft', async ({ page }) => {
  await login(page)
  const response = await page.request.get('/api/v1/project-charter/catalogs/types?active=1')
  expect(response.status()).toBe(200)
  const item = (await response.json()).items[0]
  expect(item).toBeTruthy()

  await page.goto(`/projects/settings/catalogs/types/${item.id}/edit?returnTo=${encodeURIComponent('/projects/settings/catalogs/types')}`)
  const name = page.getByLabel('الاسم')
  await expect(name).toBeVisible()
  const draft = `${item.name} مسودة`
  await name.fill(draft)
  await page.getByRole('link', { name: 'العودة إلى إعدادات المشاريع' }).click()

  const dialog = page.getByRole('alertdialog', { name: 'تغييرات غير محفوظة' })
  await expect(dialog).toBeVisible()
  await expect(name).toHaveValue(draft)
  await dialog.getByRole('button', { name: 'البقاء في الصفحة' }).click()
  await expect(name).toHaveValue(draft)
  await page.getByRole('link', { name: 'العودة إلى إعدادات المشاريع' }).click()
  await dialog.getByRole('button', { name: 'المغادرة بدون حفظ' }).click()
  await expect(page).toHaveURL(/\/settings\/projects\/catalogs\/types$/)
})
