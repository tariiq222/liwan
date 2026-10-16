import { expect, test } from '@playwright/test'
import { expectNoSecondH1, fitsWidth, login, navigateClient, open } from './commercial-helpers'

test.describe('the vendor today page', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('leads with the items that need action, each naming the customer and the exact place', async ({ page }) => {
      await open(page, '/overview')
      await expectNoSecondH1(page)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('اليوم')
      const items = page.getByTestId('attention-item')
      await expect(items).toHaveCount(5)
      await expect(items.first()).toContainText('شركة ألفا')
      await expect(items.first()).toContainText('افتح الفاتورة')
      await expect(items.first().getByRole('link')).toHaveAttribute('href', '/invoices/inv-1')
      await expect(page.locator('[data-kind="stalled_activation"] a')).toHaveAttribute('href', '/customers/cust-beta?tab=workspace')
      await expect(page.locator('[data-kind="setup_required"] a')).toHaveAttribute('href', '/customers/cust-gamma?tab=subscription')
      await expect(page.locator('[data-kind="operation_failed"] a')).toHaveAttribute('href', /\/operations\/op-2\?source=legacy/)
      await expect(page.getByTestId('today-status').getByTestId('status-failedOperations')).toBeVisible()
    })

    test('says calmly that nothing needs action when the list is empty', async ({ page }) => {
      await open(page, '/customers')
      await page.route('**/api/vendor/v1/commercial/attention', route => route.fulfill({ json: { items: [], total: 0, counts: { subscriptions_active: 2, subscriptions_pending: 0, past_due: 0, stalled: 0, setup_required: 0, renewals: 0 } } }))
      await navigateClient(page, '/overview')
      await expect(page.getByTestId('today-empty')).toContainText('لا شيء يحتاج تصرّفك الآن')
    })

    test('a failing attention list shows a retry and keeps the queue counts', async ({ page }) => {
      await open(page, '/customers')
      await page.route('**/api/vendor/v1/commercial/attention', route => route.fulfill({ status: 503, json: { code: 'vendor_unavailable', message: 'down' } }))
      await navigateClient(page, '/overview')
      await expect(page.getByTestId('today-attention').getByRole('button', { name: 'إعادة المحاولة' })).toBeVisible()
      await expect(page.getByTestId('status-tenants')).toBeVisible()
    })

    test('an attention list that is not deployed yet says so and keeps the queue counts', async ({ page }) => {
      await open(page, '/customers')
      await page.route('**/api/vendor/v1/commercial/attention', route => route.fulfill({ status: 404, json: { code: 'not_found', message: 'missing' } }))
      await navigateClient(page, '/overview')
      await expect(page.getByTestId('today-attention')).toContainText('تعذّر تحميل')
      await expect(page.getByTestId('status-tenants')).toBeVisible()
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })
    test('fits the phone width', async ({ page }) => {
      await open(page, '/overview')
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
