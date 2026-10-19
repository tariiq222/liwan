import { expect, test } from '@playwright/test'
import { fitsWidth, loginAdmin, openShell } from './support/tasmim6d'

// Plan 6d: /settings/company/branding keeps SettingsPage and its form; its loading placeholder is the shared one.
test.describe('Plan 6d: branding', () => {
  test.beforeEach(async ({ page }) => { await loginAdmin(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('keeps one heading, the settings layout and the colour form', async ({ page }) => {
      await openShell(page, '/settings/company/branding')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByTestId('settings-layout')).toBeVisible()
      await expect(page.getByTestId('branding-form')).toBeVisible()
      await expect(page.getByTestId('branding-color')).toBeVisible()
      await expect(page.getByTestId('branding-preview')).toHaveCount(0)
      await expect(page.getByTestId('branding-secondary-color')).toHaveCount(0)
    })

    test('a removed branding capability is refreshed client-side and blocks the form', async ({ page }) => {
      await openShell(page, '/projects')
      const meResponse = await page.request.get('/api/v1/me')
      const me = await meResponse.json()
      let calls = 0
      await page.route('**/api/v1/me', route => {
        calls++
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...me, capabilities: me.capabilities.filter((key: string) => key !== 'settings.branding.manage') }) })
      })
      const status = await page.evaluate(() => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } }).useNuxtApp().$router.push('/settings/company/branding').then(() => null, error => error.statusCode))
      await expect.poll(() => calls).toBeGreaterThan(0)
      expect(status).toBe(403)
      await expect(page).toHaveURL(/\/projects$/)
      await expect(page.getByTestId('branding-form')).toHaveCount(0)
    })

    test('the loading placeholder is the shared skeleton and it goes away', async ({ page }) => {
      let release: () => void = () => {}
      const gate = new Promise<void>((resolve) => { release = resolve })
      await page.route('**/api/v1/admin/branding', async (route) => { await gate; await route.fallback() })
      await openShell(page, '/projects')
      await page.evaluate(() => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } }).useNuxtApp().$router.push('/settings/company/branding'))
      await expect(page.locator('[data-slot="loading-skeleton"]')).toBeVisible()
      release()
      await expect(page.locator('[data-slot="loading-skeleton"]')).toHaveCount(0)
      await expect(page.getByTestId('branding-form')).toBeVisible()
    })

    test('a failing load keeps its own alert with a retry', async ({ page }) => {
      await openShell(page, '/projects')
      await page.route('**/api/v1/admin/branding', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"server_error","message":"boom"}' }))
      await page.evaluate(() => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } }).useNuxtApp().$router.push('/settings/company/branding'))
      await expect(page.getByTestId('branding-load-error')).toBeVisible()
      await expect(page.getByTestId('branding-retry')).toBeEnabled()
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })
    test('on a 390px phone the form fits the width', async ({ page }) => {
      await openShell(page, '/settings/company/branding')
      await expect(page.getByTestId('branding-color')).toBeVisible()
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
