import { expect, test } from '@playwright/test'
import { fitsWidth, loginAdmin, mockAdminApi, openClientSide, openShell } from './support/tasmim6d'

// Plan 6d: /settings/users/:id on SharedRecordPage with route tabs, a properties aside and record sections.
test.describe('Plan 6d: the user record', () => {
  test.beforeEach(async ({ page }) => { await loginAdmin(page); await mockAdminApi(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('is the record template: one h1, tabs, a properties aside and the two sections', async ({ page }) => {
      await openClientSide(page, '/settings/users/11?q=sara&status=active')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('سارة محمد')
      await expect(page.locator('[data-template="record"]')).toHaveCount(1)
      await expect(page.getByRole('navigation', { name: 'أقسام حساب المستخدم', exact: true })).toBeVisible()
      await expect(page.getByTestId('settings-layout')).toBeVisible()
      await expect(page.getByTestId('user-tab-account')).toHaveAttribute('aria-current', 'page')
      await expect(page.getByTestId('user-tab-access')).toHaveAttribute('href', /\/settings\/users\/11\/access\?.*q=sara/)
      await expect(page.getByTestId('user-tab-security')).toBeVisible()
      const aside = page.locator('#account')
      await expect(aside).toContainText('sara')
      await expect(aside).toContainText('سارة محمد')
      await expect(page.locator('#roles')).toContainText('مدير المشاريع')
      await expect(page.locator('#capabilities')).toContainText('عرض المشاريع')
      await expect(page.locator('main').getByRole('heading', { level: 2 })).toHaveCount(3)
    })

    test('the back link returns to the list with its filters', async ({ page }) => {
      await openClientSide(page, '/settings/users/11?q=sara&offset=25')
      await page.getByRole('link', { name: 'رجوع' }).first().click()
      await expect(page).toHaveURL(/\/settings\/users\?.*q=sara/)
      expect(new URL(page.url()).searchParams.get('offset')).toBe('25')
    })

    test('a missing user shows the not-found state under one heading and no tabs', async ({ page }) => {
      await openShell(page, '/projects')
      for (const id of ['999', '0', 'abc', '-1', '1.5', '9007199254740992']) {
        await page.evaluate(target => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } }).useNuxtApp().$router.push(target), `/settings/users/${id}`)
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
        await expect(page.locator('[data-slot="not-found-state"]')).toBeVisible()
        await expect(page.locator('[data-slot="record-aside"]')).toHaveCount(0)
        await expect(page.getByTestId('user-tab-account')).toHaveCount(0)
      }
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })
    test('on a 390px phone the aside follows the main column and nothing overflows', async ({ page }) => {
      await openClientSide(page, '/settings/users/11')
      await expect(page.locator('#account')).toBeVisible()
      await expect(page.locator('#roles')).toBeVisible()
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
