import { expect, test, type Page } from '@playwright/test'
import { fitsWidth, loginAdmin, mockAdminApi, openClientSide } from './support/tasmim6d'

// Plan 6d: /settings/team/access-log on SharedListPage + SharedDataTable.
const rows = (page: Page) => page.locator('tbody tr[data-shortcut-row]')
const mobileRows = (page: Page) => page.locator('li[data-shortcut-row]')

test.describe('Plan 6d: the access log', () => {
  test.beforeEach(async ({ page }) => { await loginAdmin(page); await mockAdminApi(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('is the list template: one h1, a table of events, no create button', async ({ page }) => {
      await openClientSide(page, '/settings/team/access-log')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('سجل تغييرات الوصول')
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await expect(page.getByTestId('settings-layout')).toBeVisible()
      await expect(rows(page)).toHaveCount(3)
      await expect(rows(page).first().getByRole('link').first()).toContainText(/٢٠٢٦|2026/)
      await expect(page.locator('[data-shortcut-create]')).toHaveCount(0)
      await expect(rows(page).first().getByRole('link').first()).toHaveAttribute('href', /\/settings\/team\/access-log\/31/)
      await expect(page.locator('#filters')).toBeVisible()
    })

    test('an opened event keeps the filters in its return path', async ({ page }) => {
      await openClientSide(page, '/settings/team/access-log?target_type=user&target_id=11')
      const link = rows(page).first().getByRole('link').first()
      await expect(link).toHaveAttribute('href', /target_type=user/)
      await link.click()
      await expect(page).toHaveURL(/\/settings\/team\/access-log\/31\?.*target_id=11/)
      await page.getByRole('link', { name: 'رجوع' }).first().click()
      await expect(page).toHaveURL(/\/settings\/team\/access-log\?.*target_type=user/)
    })

    test('J and K move between rows', async ({ page }) => {
      await openClientSide(page, '/settings/team/access-log')
      await expect(rows(page)).toHaveCount(3)
      await page.keyboard.press('j')
      await expect(rows(page).first()).toBeFocused()
      await page.keyboard.press('j')
      await page.keyboard.press('k')
      await expect(rows(page).first()).toBeFocused()
    })

    test('a failing list shows the error state with a working retry', async ({ page }) => {
      let calls = 0
      let failing = true
      await page.route('**/api/v1/admin/access-log?*', (route) => {
        calls += 1
        return failing ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"server_error","message":"boom"}' }) : route.fallback()
      })
      await openClientSide(page, '/settings/team/access-log')
      await expect(page.locator('[data-slot="error-state"]')).toBeVisible()
      await expect.poll(() => calls).toBeGreaterThan(0)
      failing = false
      await page.locator('[data-slot="error-state"]').getByRole('button', { name: 'إعادة المحاولة', exact: true }).click()
      await expect(rows(page)).toHaveCount(3)
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })
    test('on a 390px phone the mobile rows carry the same information and J skips the hidden table', async ({ page }) => {
      await openClientSide(page, '/settings/team/access-log')
      await expect(mobileRows(page)).toHaveCount(3)
      await expect(rows(page).first()).toBeHidden()
      await expect(mobileRows(page).first()).toContainText('سارة محمد')
      await expect(mobileRows(page).first()).toContainText('Admin')
      await page.keyboard.press('j')
      await expect(mobileRows(page).first()).toBeFocused()
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
