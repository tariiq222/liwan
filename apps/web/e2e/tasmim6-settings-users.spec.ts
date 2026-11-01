import { expect, test, type Page } from '@playwright/test'
import { fitsWidth, loginAdmin, mockAdminApi, openClientSide } from './support/tasmim6d'

// Plan 6d: /settings/team/users on SharedListPage + SharedDataTable (isolated mock stack, admin API fulfilled in the browser).
const rows = (page: Page) => page.locator('tbody tr[data-shortcut-row]')
const mobileRows = (page: Page) => page.locator('li[data-shortcut-row]')

test.describe('Plan 6d: the users list', () => {
  test.beforeEach(async ({ page }) => { await loginAdmin(page); await mockAdminApi(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('is the list template with a table, the grant button and one heading', async ({ page }) => {
      await openClientSide(page, '/settings/team/users')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('المستخدمون')
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await expect(page.getByTestId('settings-layout')).toBeVisible()
      await expect(rows(page)).toHaveCount(3)
      const create = page.locator('[data-shortcut-create]')
      await expect(create).toHaveCount(1)
      await expect(create).toHaveAttribute('href', /\/settings\/team\/users\/new/)
      await expect(page.getByTestId('settings-user-new')).toBeVisible()
      await expect(rows(page).first().getByRole('link').first()).toHaveAttribute('href', /\/settings\/team\/users\/11/)
      await expect(page.locator('#filters')).toBeVisible()
      await expect(page.locator('#results')).toBeVisible()
    })

    test('an opened row keeps the search in its return path and Back restores it', async ({ page }) => {
      await openClientSide(page, '/settings/team/users?q=sara')
      await expect(rows(page)).toHaveCount(1)
      const link = rows(page).first().getByRole('link').first()
      await expect(link).toHaveAttribute('href', /q=sara/)
      await link.click()
      await expect(page).toHaveURL(/\/settings\/team\/users\/11\?.*q=sara/)
      await page.goBack()
      await expect(page).toHaveURL(/q=sara/)
      await expect(page.locator('[data-shortcut-search] input')).toHaveValue('sara')
      await expect(rows(page)).toHaveCount(1)
    })

    test('J moves between rows, / focuses the search and C opens the grant panel', async ({ page }) => {
      await openClientSide(page, '/settings/team/users')
      await expect(rows(page)).toHaveCount(3)
      await page.keyboard.press('j')
      await expect(rows(page).first()).toBeFocused()
      await page.keyboard.press('j')
      await expect(rows(page).nth(1)).toBeFocused()
      await page.keyboard.press('/')
      await expect(page.locator('[data-shortcut-search] input')).toBeFocused()
      await page.keyboard.press('Escape')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('c')
      await expect(page).toHaveURL(/\/settings\/team\/users\/new/)
    })

    test('a refused list shows the forbidden state, a failing one an error with retry', async ({ page }) => {
      await page.route('**/api/v1/admin/users?*', route => route.fulfill({ status: 403, contentType: 'application/json', body: '{"code":"forbidden","message":"no"}' }))
      await openClientSide(page, '/settings/team/users')
      await expect(page.locator('[data-slot="forbidden-state"]')).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(rows(page)).toHaveCount(0)
      await page.unroute('**/api/v1/admin/users?*')
      let failing = true
      await page.route('**/api/v1/admin/users?*', route => failing
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"server_error","message":"boom"}' })
        : route.fallback())
      await openClientSide(page, '/settings/team/users')
      const error = page.locator('[data-slot="error-state"]')
      await expect(error).toBeVisible()
      await expect(error).toHaveAttribute('role', 'alert')
      failing = false
      await error.getByRole('button', { name: 'إعادة المحاولة', exact: true }).click()
      await expect(rows(page)).toHaveCount(3)
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('on a 390px phone the mobile rows carry the same information and J skips the hidden table', async ({ page }) => {
      await openClientSide(page, '/settings/team/users')
      await expect(mobileRows(page)).toHaveCount(3)
      await expect(rows(page).first()).toBeHidden()
      const first = mobileRows(page).first()
      await expect(first).toContainText('سارة محمد')
      await expect(first).toContainText('sara')
      await expect(first).toContainText('مدير المشاريع')
      await expect(first.getByRole('link', { name: 'سارة محمد', exact: true })).toHaveAttribute('href', /\/settings\/team\/users\/11$/)
      await expect(first.getByTestId('row-actions-menu')).toBeVisible()
      await page.keyboard.press('j')
      await expect(first).toBeFocused()
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
