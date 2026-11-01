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
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
}

test('project settings links to both catalogs without a shared nav item', async ({ page }) => {
  await login(page)
  await page.goto('/settings/apps/projects')
  await expect(page.getByRole('heading', { name: 'المشاريع', exact: true })).toBeVisible()
  await expect(page.getByTestId('catalog-types-link')).toBeVisible()
  await expect(page.getByTestId('catalog-units-link')).toBeVisible()
  await page.getByTestId('catalog-types-link').click()
  await expect(page).toHaveURL(/\/settings\/apps\/projects\/catalogs\/types/)
  await expect(page.getByRole('heading', { name: 'أنواع المشاريع' })).toBeVisible()
  // The mock lists its active types: «داخلي» and «خارجي».
  await expect(page.getByRole('table').getByText('داخلي', { exact: true })).toBeVisible()
  await expect(page.getByRole('table').getByText('خارجي', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'العودة إلى إعدادات المشاريع' }).click()
  await expect(page).toHaveURL(/\/settings\/apps\/projects/)
})

test('catalog edit departure is guarded while preserving the draft', async ({ page }) => {
  await login(page)
  const response = await page.request.get('/api/v1/project-charter/catalogs/types?active=1')
  expect(response.status()).toBe(200)
  const item = (await response.json()).items[0]
  expect(item).toBeTruthy()

  await page.goto(`/settings/apps/projects/catalogs/types/${item.id}/edit?returnTo=${encodeURIComponent('/settings/apps/projects/catalogs/types')}`)
  const name = page.getByLabel('الاسم')
  await expect(name).toBeVisible()
  const draft = `${item.name} مسودة`
  await name.fill(draft)
  await page.getByRole('link', { name: 'العودة إلى إعدادات المشاريع' }).click()

  const dialog = page.getByTestId('unsaved-changes-dialog')
  await expect(dialog).toBeVisible()
  await expect(name).toHaveValue(draft)
  await dialog.getByRole('button', { name: 'البقاء في الصفحة' }).click()
  await expect(name).toHaveValue(draft)
  await page.getByRole('link', { name: 'العودة إلى إعدادات المشاريع' }).click()
  await dialog.getByRole('button', { name: 'المغادرة بدون حفظ' }).click()
  await expect(page).toHaveURL(/\/settings\/apps\/projects\/catalogs\/types$/)
})
