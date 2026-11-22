import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { expectNoSecondH1, fitsWidth, login, navigateClient, open } from './commercial-helpers'

const overview = JSON.parse(readFileSync(new URL('./commercial-fixtures.json', import.meta.url), 'utf8')).overview
const health = (state: Record<string, string>) => overview.health.map((item: { component: string }) => ({ ...item, ...(state[item.component] ? { state: state[item.component] } : {}) }))

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

    test('shows the services above the counts, a chip each with its state', async ({ page }) => {
      await open(page, '/overview')
      const services = page.getByTestId('today-services')
      await expect(services.getByRole('heading', { level: 2 })).toHaveText('الخدمات')
      await expect(services.locator('[data-testid^="health-"]')).toHaveCount(6)
      await expect(services.getByTestId('health-shared_worker')).toHaveAttribute('data-state', 'ok')
      await expect(services.getByTestId('health-mail_adapter')).toHaveAttribute('data-state', 'unavailable')
      await expect(services.getByTestId('health-mail_adapter')).toContainText('mail_not_configured')
      await expect(services.getByTestId('health-alert_channel')).toHaveAttribute('data-state', 'never_seen')
      await expect(services).toContainText('آخر فحص لمساحات العمل')
      const above = await page.evaluate(() => document.querySelector('[data-testid="today-services"]')!.compareDocumentPosition(document.querySelector('[data-testid="today-status"]')!) & Node.DOCUMENT_POSITION_FOLLOWING)
      expect(above).toBeTruthy()
    })

    test('shows the adapters of a stale worker as unknown', async ({ page }) => {
      await open(page, '/customers')
      await page.route('**/api/vendor/v1/overview*', route => route.fulfill({ json: { ...overview, health: health({ shared_worker: 'stale' }) } }))
      await navigateClient(page, '/overview')
      await expect(page.getByTestId('health-shared_worker')).toHaveAttribute('data-state', 'stale')
      await expect(page.getByTestId('health-payment_adapter')).toHaveAttribute('data-state', 'unknown')
      await expect(page.getByTestId('health-mail_adapter')).toHaveAttribute('data-state', 'unknown')
      await expect(page.getByTestId('health-api_payment_adapter')).toHaveAttribute('data-state', 'ok')
    })

    test('says the services could not be read when the server sends no health, and keeps the counts', async ({ page }) => {
      await open(page, '/customers')
      await page.route('**/api/vendor/v1/overview*', route => route.fulfill({ json: { ...overview, health: null } }))
      await navigateClient(page, '/overview')
      await expect(page.getByTestId('today-health-unreadable')).toBeVisible()
      await expect(page.getByTestId('status-tenants')).toBeVisible()
    })

    test('lists a service that stopped in the attention list by its name, with nothing to open', async ({ page }) => {
      await open(page, '/customers')
      const item = { kind: 'service_down', customer_id: null, tenant_id: null, operation_id: null, invoice_id: null, name: 'shared_worker', since: '2026-11-22T08:00:00Z', detail: 'stale' }
      await page.route('**/api/vendor/v1/commercial/attention', route => route.fulfill({ json: { items: [item], total: 1, counts: { subscriptions_active: 2, subscriptions_pending: 0, past_due: 0, stalled: 0, setup_required: 0, renewals: 0 } } }))
      await navigateClient(page, '/overview')
      const row = page.locator('[data-kind="service_down"]')
      await expect(row).toContainText('عامل المنصة المشتركة')
      await expect(row).toContainText('توقفت عن الإبلاغ')
      await expect(row.getByRole('link')).toHaveCount(0)
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
