import { NotificationDigestDetailSchema } from '@nasq/contracts'
import { expect, test } from '@playwright/test'
import { fitsWidth, loginAdmin, openShell } from './support/tasmim6d'

// Plan 6d: /notification-digests/:id on SharedRecordPage (digest fulfilled in the browser).
const DIGEST = NotificationDigestDetailSchema.parse({
  id: 501, kind: 'overdue_digest', local_date: '2026-10-14',
  items: [{ id: 101, name: 'مهمة متأخرة', state: 'in_progress', priority: '1', date_deadline: null, days_remaining: null, is_overdue: true, is_closed: false, personal_stage: null, stage: null, assignees: [], tags: [], allowed_transitions: [], project: { id: 1, name: 'مشروع ألفا' } }, { id: 102, name: 'مهمة أخرى', state: 'in_progress', priority: '1', date_deadline: null, days_remaining: null, is_overdue: true, is_closed: false, personal_stage: null, stage: null, assignees: [], tags: [], allowed_transitions: [], project: { id: 1, name: 'مشروع ألفا' } }],
  overdue_count: 2, total: 2,
})
async function openDigest(page: import('@playwright/test').Page, id = 501) {
  await openShell(page, '/projects')
  let calls = 0
  await page.route(`**/api/v1/notification-digests/${id}*`, route => { calls++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DIGEST) }) })
  await page.evaluate(target => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } }).useNuxtApp().$router.push(target), `/notification-digests/${id}`)
  await expect.poll(() => calls).toBeGreaterThan(0)
}

test.describe('Plan 6d: the notification digest', () => {
  test.beforeEach(async ({ page }) => { await loginAdmin(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('is the record template with the overdue tasks and a back link to the list', async ({ page }) => {
      await openDigest(page)
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.locator('[data-template="record"]')).toHaveCount(1)
      await expect(page.getByTestId('notification-digest')).toBeVisible()
      await expect(page.getByTestId('digest-task-101')).toContainText('مهمة متأخرة')
      await expect(page.getByTestId('digest-task-102')).toBeVisible()
      await expect(page.getByRole('link', { name: 'العودة' })).toHaveAttribute('href', /^\/notifications/)
    })

    test('the back link retains list query state and drops its referrer', async ({ page }) => {
      await openDigest(page)
      await page.evaluate(() => (window as unknown as { useNuxtApp: () => { $router: { replace: (to: string) => Promise<unknown> } } }).useNuxtApp().$router.replace('/notification-digests/501?offset=50&q=abc&returnTo=%2Ftasks'))
      const back = page.getByRole('link', { name: 'العودة' })
      await expect(back).toHaveAttribute('href', '/notifications?offset=50&q=abc')
      await back.click()
      await expect(page).toHaveURL(/\/notifications\?offset=50&q=abc$/)
    })

    test('a task opens its page and an invalid id shows the invalid block', async ({ page }) => {
      await openDigest(page)
      await page.getByTestId('digest-task-101').click()
      await expect(page).toHaveURL(/\/tasks\/101/)
      await openShell(page, '/notification-digests/abc')
      await expect(page.getByTestId('digest-invalid')).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    })

    test('an empty digest keeps its empty block', async ({ page }) => {
      await openShell(page, '/projects')
      await page.route('**/api/v1/notification-digests/777*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...DIGEST, id: 777, items: [], overdue_count: 0, total: 0 }) }))
      await page.evaluate(() => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } }).useNuxtApp().$router.push('/notification-digests/777'))
      await expect(page.getByTestId('digest-empty')).toBeVisible()
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })
    test('on a 390px phone the rows fit the width', async ({ page }) => {
      await openDigest(page)
      await expect(page.getByTestId('digest-task-101')).toBeVisible()
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
