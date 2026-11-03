import { test, expect, type Page } from '@playwright/test'
import { MOCK_STACK_ONLY } from './support/mock-pages'

// Runs against the isolated synthetic stack (MODULE_UI_PREVIEW=1): the CRM mock keeps state, reset before each test.
test.skip(process.env.E2E_PROJECT_POPUPS !== '1', MOCK_STACK_ONLY)

async function login(page: Page) {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.beforeEach(async ({ page }) => {
  await login(page)
  const reset = await page.request.post('/api/v1/__mock/reset-crm', { data: {} })
  expect(reset.ok()).toBe(true)
})

test('the record page saves a probability between 0 and 100 and shows it after a reload', async ({ page }) => {
  await page.goto('/crm/opportunities/1')
  await expect(page.locator('main h1')).toHaveText('أحمد العتيبي')
  const input = page.getByTestId('crm-probability-input')
  await expect(input).toHaveValue('25')
  await input.fill('50')
  await input.blur()
  await page.getByTestId('crm-probability-save').click()
  await expect(page.getByTestId('crm-probability-save')).toBeDisabled()
  expect((await (await page.request.get('/api/v1/crm/opportunities/1')).json()).probability).toBe(50)
  await page.reload()
  await expect(page.getByTestId('crm-probability-input')).toHaveValue('50')
})

test('the list shows the probability of every row, and the mock refuses a value outside 0..100', async ({ page }) => {
  await page.goto('/crm/opportunities')
  const table = page.locator('table')
  await expect(table.getByRole('columnheader', { name: 'الاحتمال' })).toBeVisible()
  await expect(page.getByRole('row', { name: /أحمد العتيبي/ })).toContainText('25%')
  await expect(page.getByRole('row', { name: /سارة القحطاني/ })).toContainText('50%')
  await expect(page.getByRole('row', { name: /محمد الدوسري/ })).toContainText('75%')

  for (const probability of [-1, 101]) {
    const refused = await page.request.patch('/api/v1/crm/opportunities/1', { data: { probability } })
    expect(refused.status()).toBe(422)
    expect(await refused.json()).toMatchObject({ field: 'probability' })
  }
})

test('an unsaved probability asks before leaving and is dropped after it is saved', async ({ page }) => {
  await page.goto('/crm/opportunities/1')
  const guard = page.getByTestId('unsaved-changes-dialog')
  const input = page.getByTestId('crm-probability-input')
  await input.fill('60')
  await input.blur()
  await page.getByRole('link', { name: 'رجوع إلى القائمة' }).click()
  await expect(guard).toBeVisible()
  await guard.getByRole('button', { name: 'البقاء في الصفحة', exact: true }).click()
  await expect(input).toHaveValue('60')
  await page.getByTestId('crm-probability-save').click()
  await expect(page.getByTestId('crm-probability-save')).toBeDisabled()
  await page.getByRole('link', { name: 'رجوع إلى القائمة' }).click()
  await expect(page).toHaveURL(/\/crm\/opportunities(\?|$)/)
  await expect(guard).toHaveCount(0)
})
