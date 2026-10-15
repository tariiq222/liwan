import { expect, test } from '@playwright/test'
import { loginAdmin } from './support/tasmim6d'

// Plan 6d: the error page. A signed-in user keeps the shell around it; the standalone card is the signed-out fallback.
test.describe('Plan 6d: the error page', () => {
  test.beforeEach(async ({ page }) => { await loginAdmin(page) })

  test('an unknown route renders inside the shell with one main, one h1, the code and a way home', async ({ page }) => {
    await page.goto('/this-page-does-not-exist')
    await page.waitForFunction(() => { const app = (window as unknown as { useNuxtApp?: () => { isHydrating: boolean } }).useNuxtApp; return typeof app === 'function' && !app().isHydrating })
    const error = page.getByTestId('app-error')
    await expect(error).toBeVisible()
    await expect(page.locator('main')).toHaveCount(1)
    await expect(page.getByTestId('module-rail')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('الصفحة غير موجودة')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(error.getByText('404', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'العودة إلى الصفحة الرئيسية' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  })

  test('the home button leaves the error page', async ({ page }) => {
    await page.goto('/this-page-does-not-exist')
    await page.waitForFunction(() => { const app = (window as unknown as { useNuxtApp?: () => { isHydrating: boolean } }).useNuxtApp; return typeof app === 'function' && !app().isHydrating })
    await page.getByRole('button', { name: 'العودة إلى الصفحة الرئيسية' }).click()
    await expect(page.getByTestId('app-error')).toHaveCount(0)
  })

  test('on a 390px phone the card fits the width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/this-page-does-not-exist')
    await page.waitForFunction(() => { const app = (window as unknown as { useNuxtApp?: () => { isHydrating: boolean } }).useNuxtApp; return typeof app === 'function' && !app().isHydrating })
    await expect(page.getByTestId('app-error')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
