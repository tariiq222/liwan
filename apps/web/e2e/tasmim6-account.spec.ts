import { expect, test } from '@playwright/test'
import { fitsWidth, loginAdmin, openShell } from './support/tasmim6d'

// Plan 6d: /account/settings on SettingsPage with a properties panel and a password section.
test.describe('Plan 6d: the account page', () => {
  test.beforeEach(async ({ page }) => { await loginAdmin(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('is the settings template: one h1, the profile facts and the password form', async ({ page }) => {
      await openShell(page, '/account/settings')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('إعدادات حسابي')
      await expect(page.getByTestId('settings-layout')).toBeVisible()
      const profile = page.locator('[data-slot="properties-panel"]')
      await expect(profile).toHaveCount(1)
      await expect(profile.locator('dd').first()).toBeVisible()
      for (const id of ['pw-current', 'pw-new', 'pw-confirm', 'pw-submit']) await expect(page.getByTestId(id)).toBeVisible()
    })

    test('the hydrated form accepts input and has no scoped account style', async ({ page }) => {
      await openShell(page, '/account/settings')
      await expect(page.getByTestId('pw-submit')).toBeEnabled()
      await page.getByTestId('pw-current').fill('current-secret')
      await page.getByTestId('pw-new').fill('Brand-New-Secret-1!')
      await page.getByTestId('pw-confirm').fill('Brand-New-Secret-1!')
      await expect(page.getByTestId('pw-submit')).toBeEnabled()
      expect(await page.locator('.liwan-account-page').count()).toBe(0)
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })
    test('on a 390px phone the profile and the form fit the width', async ({ page }) => {
      await openShell(page, '/account/settings')
      await expect(page.getByTestId('pw-submit')).toBeVisible()
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
