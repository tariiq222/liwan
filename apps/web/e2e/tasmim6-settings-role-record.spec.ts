import { expect, test } from '@playwright/test'
import { ROLE_DETAIL, USERS, fitsWidth, loginAdmin, mockAdminApi, openClientSide } from './support/tasmim6d'

// Plan 6d: /settings/roles/:id on SharedRecordPage (admin API fulfilled in the browser).
test.describe('Plan 6d: the role record', () => {
  test.beforeEach(async ({ page }) => { await loginAdmin(page); await mockAdminApi(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('is the record template: one h1, tabs, the permission form, assigned users and the aside', async ({ page }) => {
      await openClientSide(page, '/settings/roles/3?q=%D9%85&type=custom')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('مراجع')
      await expect(page.locator('[data-template="record"]')).toHaveCount(1)
      await expect(page.getByRole('navigation', { name: 'أقسام الدور', exact: true })).toBeVisible()
      await expect(page.getByTestId('settings-layout')).toBeVisible()
      await expect(page.getByTestId('role-tab-permissions')).toHaveAttribute('aria-current', 'page')
      await expect(page.getByTestId('role-tab-changes')).toHaveAttribute('href', /target_type=role&target_id=3/)
      await expect(page.locator('#assigned-users')).toBeVisible()
      await expect(page.locator('#assigned-users tbody tr[data-shortcut-row]')).toHaveCount(USERS.items.length)
      await expect(page.locator('[data-slot="record-aside"]')).toContainText('دور مخصص للمراجعة')
      await page.getByTestId('row-actions-menu').click()
      await expect(page.getByRole('menuitem', { name: 'إيقاف الدور' })).toBeVisible()
      await page.keyboard.press('Escape')
    })

    test('disable asks inline, cancel closes it, and nothing opens a dialog', async ({ page }) => {
      await openClientSide(page, '/settings/roles/3')
      await page.getByTestId('row-actions-menu').click()
      await page.getByRole('menuitem', { name: 'إيقاف الدور' }).click()
      await expect(page.getByRole('button', { name: 'تأكيد', exact: true })).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.getByRole('button', { name: 'إلغاء', exact: true }).click()
      await expect(page.getByRole('button', { name: 'تأكيد', exact: true })).toHaveCount(0)
    })

    test('confirming disable posts once and shows the updated role', async ({ page }) => {
      let posts = 0
      const updated = { ...ROLE_DETAIL, active: false, allowed_actions: ['read', 'edit', 'clone', 'enable', 'delete'] }
      await page.route('**/api/v1/admin/roles/3', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(posts ? updated : ROLE_DETAIL) }))
      await page.route('**/api/v1/admin/roles/3/disable', (route) => {
        expect(route.request().postDataJSON()).toEqual({ expected_version: ROLE_DETAIL.version })
        posts += 1
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(updated) })
      })
      await openClientSide(page, '/settings/roles/3')
      await page.getByTestId('row-actions-menu').click()
      await page.getByRole('menuitem', { name: 'إيقاف الدور' }).click()
      await page.getByRole('button', { name: 'تأكيد', exact: true }).click()
      await expect.poll(() => posts).toBe(1)
      await page.getByTestId('row-actions-menu').click()
      await expect(page.getByRole('menuitem', { name: "تفعيل الدور" })).toBeVisible()
      await page.keyboard.press('Escape')
      await page.getByTestId('row-actions-menu').click()
      await expect(page.getByRole('menuitem', { name: 'إيقاف الدور' })).toHaveCount(0)
      await page.keyboard.press('Escape')
    })

    test('a version conflict keeps its alert and a missing role shows the not-found state', async ({ page }) => {
      await page.route('**/api/v1/admin/roles/3', route => route.fulfill({ status: 409, contentType: 'application/json', body: '{"code":"conflict","message":"stale"}' }))
      await openClientSide(page, '/settings/roles/3')
      await expect(page.locator('[data-slot="record-main"] [role="alert"]')).toContainText("تغير الدور أثناء التحرير. أعد تحميل النسخة الأحدث.")
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      // The authenticated app is already hydrated; keep these same-page record
      // navigations client-side so every request still uses the browser fixture.
      for (const id of ['999', '0', 'abc', '-1', '1.5', '9007199254740992']) {
        await page.evaluate(
          target => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } }).useNuxtApp().$router.push(target),
          `/settings/roles/${id}`,
        )
        await expect(page.locator('[data-slot="not-found-state"]')).toBeVisible()
        await expect(page.locator('[data-slot="record-aside"]')).toHaveCount(0)
        await expect(page.getByTestId('role-tab-permissions')).toHaveCount(0)
      }
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })
    test('on a 390px phone the sections stack and the assigned users show as mobile rows', async ({ page }) => {
      await openClientSide(page, '/settings/roles/3')
      await expect(page.locator('#assigned-users li[data-shortcut-row]')).toHaveCount(USERS.items.length)
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
