import { expect, test } from '@playwright/test'
import { fitsWidth, loginAdmin, mockAdminApi, openClientSide } from './support/tasmim6d'

// Plan 6d: /settings/team/users/:id/access and /security on SettingsPage + FormSection panels.
test.describe('Plan 6d: the user access and security pages', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeEach(async ({ page }) => { await loginAdmin(page); await mockAdminApi(page) })

  test('security: one heading, a panel section, the reset confirm is inline and never a dialog', async ({ page }) => {
    await openClientSide(page, '/settings/team/users/11/security')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('أمان الحساب')
    await expect(page.getByTestId('settings-layout')).toBeVisible()
    await page.locator('#admin-password').fill('Temp-Password-1!')
    await page.locator('#admin-password-confirmation').fill('Temp-Password-1!')
    await page.getByRole('button', { name: 'إعادة تعيين كلمة المرور', exact: true }).click()
    await expect(page.getByRole('button', { name: 'تأكيد', exact: true })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'إلغاء', exact: true }).click()
    await expect(page.getByRole('button', { name: 'تأكيد', exact: true })).toHaveCount(0)
    await expect(page.locator('main').getByRole('heading', { level: 2, name: 'أمان الحساب', exact: true })).toHaveCount(1)
    await expect(page.locator('#admin-password')).toHaveValue('Temp-Password-1!')
  })

  test('access: the roles form sits in the settings page with its save button', async ({ page }) => {
    await openClientSide(page, '/settings/team/users/11/access')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('تعديل الوصول')
    await expect(page.getByRole('button', { name: 'حفظ', exact: true })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('a missing user shows the not-found state under one heading', async ({ page }) => {
    await openClientSide(page, '/settings/team/users/999/security')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.locator('[data-slot="not-found-state"]')).toBeVisible()
  })

  test('on a 390px phone the forms fit the width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    for (const path of ['/settings/team/users/11/security', '/settings/team/users/11/access']) {
      await openClientSide(page, path)
      await expect(page.getByTestId('settings-layout')).toBeVisible()
      expect(await fitsWidth(page), path).toBe(true)
    }
  })
})
