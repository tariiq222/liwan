import { NotificationListSchema } from '@nasq/contracts'
import { expect, test, type Page } from '@playwright/test'
import { fitsWidth, loginAdmin, openShell } from './support/tasmim6d'

const NOTIFICATIONS = NotificationListSchema.parse({
  items: [
    { id: 501, kind: 'comment', task_id: 101, task_name: 'مهمة جارية', body: 'تعليق', created_at: '2026-09-07T10:00:00', is_read: false },
    { id: 502, kind: 'assignment', task_id: 102, task_name: 'مهمة أخرى', body: 'إسناد', created_at: '2026-09-07T09:00:00', is_read: false },
    { id: 503, kind: 'deadline', task_id: 103, task_name: 'مهمة ثالثة', body: 'موعد', created_at: '2026-09-06T08:00:00', is_read: true },
  ], total: 3, unread_count: 2,
})

async function openNotifications(page: Page) {
  await openShell(page, '/projects')
  let calls = 0
  await page.route('**/api/v1/notifications*', route => {
    calls++
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NOTIFICATIONS) })
  })
  await page.evaluate(() => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } }).useNuxtApp().$router.push('/notifications'))
  await expect.poll(() => calls).toBeGreaterThan(0)
}

// Plan 6d: /notifications on SharedListPage with J/K row navigation (isolated mock stack).
test.describe('Plan 6d: the notifications page', () => {
  test.beforeEach(async ({ page }) => { await loginAdmin(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('is the list template: one h1, the unread count, mark-all and the rows', async ({ page }) => {
      await openNotifications(page)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('الإشعارات')
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await expect(page.getByTestId('notification-center')).toBeVisible()
      for (const id of [501, 502, 503]) await expect(page.getByTestId(`notification-${id}`)).toBeVisible()
      await expect(page.locator('[data-shortcut-row]')).toHaveCount(3)
      await expect(page.getByRole('button', { name: 'تحديد الكل كمقروء' })).toBeVisible()
    })

    test('J and K move focus between notifications', async ({ page }) => {
      await openNotifications(page)
      await expect(page.getByTestId('notification-501')).toBeEnabled()
      await page.keyboard.press('j')
      await expect(page.getByTestId('notification-501')).toBeFocused()
      await page.keyboard.press('j')
      await expect(page.getByTestId('notification-502')).toBeFocused()
      await page.keyboard.press('k')
      await expect(page.getByTestId('notification-501')).toBeFocused()
    })

    test('an empty inbox shows the shared empty state under one heading', async ({ page }) => {
      await openShell(page, '/projects')
      let calls = 0
      await page.route('**/api/v1/notifications*', route => {
        calls++
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, unread_count: 0 }) })
      })
      await page.evaluate(() => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } }).useNuxtApp().$router.push('/notifications'))
      await expect.poll(() => calls).toBeGreaterThan(0)
      await expect(page.getByRole('status').filter({ hasText: 'لا توجد إشعارات' })).toBeVisible()
      await expect(page.locator('[data-shortcut-row]')).toHaveCount(0)
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    })

    test('an empty inbox and a failing load use the shared states', async ({ page }) => {
      await openShell(page, '/projects')
      await page.route('**/api/v1/notifications*', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"server_error","message":"boom"}' }))
      await page.evaluate(() => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } }).useNuxtApp().$router.push('/notifications'))
      await expect(page.locator('[data-slot="error-state"]')).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })
    test('on a 390px phone the rows fit the width', async ({ page }) => {
      await openNotifications(page)
      await expect(page.getByTestId('notification-501')).toBeVisible()
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
