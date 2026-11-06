import { expect, test } from '@playwright/test'
import { login, open } from './support/tasmim6'

test.beforeEach(async ({ page }) => { await login(page); await page.request.post('/api/v1/__mock/reset-charters') })

test('simple creation omits the charter wizard and protects an edited draft', async ({ page }) => {
  await open(page, '/projects')
  await page.getByTestId('project-new').click()
  await expect(page.getByTestId('project-basics-fields')).toBeVisible()
  await expect(page.getByTestId('charter-step-position')).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Step 0 of 7' })).toHaveCount(0)
  await page.getByTestId('project-create-name').fill('مسودة مراجعة المشاريع')
  await page.getByRole('button', { name: 'إغلاق', exact: true }).click()
  await expect(page.getByTestId('unsaved-changes-dialog')).toBeVisible()
  await page.getByRole('button', { name: 'البقاء في الصفحة', exact: true }).click()
  await expect(page.getByTestId('project-create-name')).toHaveValue('مسودة مراجعة المشاريع')
})

test('an approved charter with no approval history shows its state once', async ({ page }) => {
  await open(page, '/projects/1/charter')
  await expect(page.getByTestId('charter-state-badge')).toHaveText('معتمد')
  await expect(page.getByTestId('charter-approved')).toHaveCount(0)
})
