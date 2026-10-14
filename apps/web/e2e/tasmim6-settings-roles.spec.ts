import { expect, test, type Page } from '@playwright/test'
import { fitsWidth, loginAdmin, mockAdminApi, openClientSide } from './support/tasmim6d'

// Plan 6d: /settings/roles on SharedListPage + SharedDataTable; roles/new and roles/:id/edit on FormSection panels.
const rows = (page: Page) => page.locator('tbody tr[data-shortcut-row]')
const mobileRows = (page: Page) => page.locator('li[data-shortcut-row]')

test.describe('Plan 6d: the roles list and forms', () => {
  test.beforeEach(async ({ page }) => { await loginAdmin(page); await mockAdminApi(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('is the list template with a table, the create button and one heading', async ({ page }) => {
      await openClientSide(page, '/settings/roles')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('الأدوار والصلاحيات')
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await expect(page.getByTestId('settings-layout')).toBeVisible()
      await expect(rows(page)).toHaveCount(3)
      await expect(page.locator('[data-shortcut-create]')).toHaveAttribute('href', /\/settings\/roles\/new/)
      await expect(page.getByTestId('settings-role-new')).toContainText('إنشاء دور')
      await expect(rows(page).first().getByRole('link').first()).toHaveAttribute('href', /\/settings\/roles\/1/)
    })

    test('the search and the type filter survive opening a role and going back', async ({ page }) => {
      await openClientSide(page, '/settings/roles?q=%D9%85%D8%B1%D8%A7%D8%AC%D8%B9&type=custom')
      await expect(rows(page)).toHaveCount(1)
      await expect(rows(page).first().getByRole('link').first()).toHaveAttribute('href', /q=.+type=custom|type=custom.*q=/)
      await rows(page).first().getByRole('link').first().click()
      await expect(page).toHaveURL(/\/settings\/roles\/3\?/)
      await page.goBack()
      await expect(page).toHaveURL(/type=custom/)
      await expect(rows(page)).toHaveCount(1)
    })

    test('J moves between rows and the clone action opens the create panel with ?clone=', async ({ page }) => {
      await openClientSide(page, '/settings/roles')
      await expect(rows(page)).toHaveCount(3)
      await page.keyboard.press('j')
      await expect(rows(page).first()).toBeFocused()
      await rows(page).nth(2).getByRole('button').last().click()
      await page.getByRole('menuitem', { name: 'نسخ' }).click()
      await expect(page).toHaveURL(/\/settings\/roles\/new\?.*clone=3/)
    })

    test('a refused list shows the forbidden state', async ({ page }) => {
      await page.route('**/api/v1/admin/roles?*', route => route.fulfill({ status: 403, contentType: 'application/json', body: '{"code":"forbidden","message":"no"}' }))
      await openClientSide(page, '/settings/roles')
      await expect(page.locator('[data-slot="forbidden-state"]')).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    })

    test('the edit page keeps its heading and uses a panel section', async ({ page }) => {
      await openClientSide(page, '/settings/roles/3/edit')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('تعديل الدور')
      await expect(page.locator('main').getByRole('heading', { level: 2 })).toHaveCount(2)
      await expect(page.getByRole('button', { name: 'حفظ', exact: true })).toBeVisible()
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('on a 390px phone the mobile rows carry the same information and J skips the hidden table', async ({ page }) => {
      await openClientSide(page, '/settings/roles')
      await expect(mobileRows(page)).toHaveCount(3)
      await expect(rows(page).first()).toBeHidden()
      await expect(mobileRows(page).nth(2)).toContainText('مراجع')
      await expect(mobileRows(page).nth(2)).toContainText('دور مخصص للمراجعة')
      await page.keyboard.press('j')
      await expect(mobileRows(page).first()).toBeFocused()
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
