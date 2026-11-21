import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { expectNoSecondH1, fitsWidth, login, mobileRows, navigateClient, open, rows } from './commercial-helpers'

const fixtures = JSON.parse(readFileSync(new URL('./commercial-fixtures.json', import.meta.url), 'utf8'))
const GROWTH = fixtures.plans.items[0]
const CORE_BUNDLE = fixtures.bundles.items[0]
// A plan with no trial: a vendor-placed first order never starts one.
const PAID_PLAN = { ...GROWTH, trial_days: 0 }

/** Intercepts what the change page reads and writes, so the specs see the exact bodies the console sends. */
async function mockOrderFlow(page: Page, plans: unknown[], orderAnswers: { status: number; body: object }[]) {
  const quotes: Record<string, unknown>[] = []; const orders: Record<string, unknown>[] = []
  await page.route('**/api/vendor/v1/commercial/plans?**', route => route.fulfill({ json: { items: plans, total: plans.length } }))
  await page.route('**/api/vendor/v1/commercial/customer-quotes', async (route) => {
    quotes.push(route.request().postDataJSON())
    await route.fulfill({ json: { ...fixtures.quote, id: `quote-${quotes.length}`, preview: false } })
  })
  await page.route('**/api/vendor/v1/commercial/orders', async (route) => {
    orders.push(route.request().postDataJSON())
    const answer = orderAnswers[Math.min(orders.length, orderAnswers.length) - 1]!
    await route.fulfill({ status: answer.status, json: answer.body })
  })
  return { quotes, orders }
}
const pick = async (page: Page, name: string, option: string) => { await page.getByRole('combobox', { name }).click(); await page.getByRole('option', { name: option }).click() }

test.describe('Plan 6e: vendor customers', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('the list is the list template with a data table and the same filters', async ({ page }) => {
      await open(page, '/customers')
      await expectNoSecondH1(page)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('العملاء')
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await expect(rows(page)).toHaveCount(3)
      await expect(page.getByTestId('customer-row').filter({ visible: true })).toHaveCount(3)
      await expect(page.getByTestId('setup-required').filter({ visible: true })).toHaveCount(1)
      await expect(page.locator('[data-shortcut-create]')).toHaveCount(1)
      await expect(page.getByTestId('customers-result-count')).toContainText('3')
    })

    test('a state filter keeps the other query keys and an unknown state falls back to all', async ({ page }) => {
      await open(page, '/customers?state=bogus&q=&source=retained')
      await expect(rows(page)).toHaveCount(3)
      await expect(page.getByRole('region', { name: 'البحث والفلاتر' })).toBeVisible()
      await page.getByRole('button', { name: 'مفعّل', exact: true }).click()
      await expect.poll(() => new URL(page.url()).searchParams.get('state')).toBe('active')
      expect(new URL(page.url()).searchParams.get('source')).toBe('retained')
    })

    test('J and K move between rows, Enter opens the record and Back returns to the filtered list', async ({ page }) => {
      await open(page, '/customers?state=all')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('j')
      await page.keyboard.press('k')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/customers\/cust-alpha/)
      expect(new URL(page.url()).searchParams.get('returnTo')).toContain('/customers')
    })

    test('an unavailable commercial list shows the not-available alert, not an empty table', async ({ page }) => {
      await open(page, '/overview')
      await page.route('**/api/vendor/v1/commercial/clients**', route => route.fulfill({ status: 501, json: { code: 'not_implemented', message: 'n' } }))
      await navigateClient(page, '/customers')
      await expect(page.locator('[data-slot="data-table"]')).toHaveCount(0)
      await expect(page.locator('#__nuxt')).toContainText('غير متاح')
    })

    test('the record is the record template: one h1, tabs, sections as h2', async ({ page }) => {
      await open(page, '/customers/cust-alpha?returnTo=%2Fcustomers')
      await expectNoSecondH1(page)
      await expect(page.getByRole('heading', { level: 1 })).toContainText('شركة ألفا')
      await expect(page.locator('[data-template="record"]')).toHaveCount(1)
      await expect(page.locator('[data-slot="customer-glance"]')).toBeVisible()
      await open(page, '/customers/cust-alpha?tab=subscription')
      await expect(page.locator('[data-slot="record-section"]').first()).toBeVisible()
      await expect(page.locator('[data-slot="properties-panel"]').first()).toBeVisible()
      await expect(page.getByTestId('branch-summary')).toBeVisible()
      await expect(page.getByTestId('usage-meter').first()).toBeVisible()
      await open(page, '/customers/cust-alpha?tab=invoices')
      await expect(page.getByTestId('customer-invoice')).toHaveCount(2)
    })

    test('cancelling a pending order asks inline first and never opens a dialog', async ({ page }) => {
      await open(page, '/customers/cust-beta?tab=subscription')
      await page.getByRole('button', { name: 'إلغاء الطلب المعلّق' }).first().click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByLabel('سبب الإلغاء (من 3 إلى 1000 حرف)')).toBeVisible()
    })

    for (const refreshState of ['loading', 'failed'] as const) {
      test(`a failed cancellation preserves its dirty reason guard during ${refreshState} customer refresh`, async ({ page }) => {
        await open(page, '/customers/cust-beta?tab=subscription')
        const reason = 'سبب الإلغاء محفوظ'
        let cancelRequests = 0
        let refreshRequests = 0
        let recoverRefresh = false
        let finishRefresh!: () => void
        const heldRefresh = new Promise<void>(resolve => { finishRefresh = resolve })
        await page.route('**/api/vendor/v1/commercial/orders/*/cancel', async route => {
          expect(route.request().method()).toBe('POST')
          expect(route.request().postDataJSON()).toEqual({ reason })
          cancelRequests++
          await route.fulfill({ status: 503, json: { code: 'vendor_unavailable', message: 'cancel failed' } })
        })
        await page.route('**/api/vendor/v1/commercial/customers/cust-beta', async route => {
          refreshRequests++
          await heldRefresh
          if (recoverRefresh) return route.continue()
          await route.fulfill({ status: 503, json: { code: 'vendor_unavailable', message: 'refresh failed' } })
        })
        try {
          await page.getByRole('button', { name: 'إلغاء الطلب المعلّق' }).first().click()
          await page.getByLabel('سبب الإلغاء (من 3 إلى 1000 حرف)').fill(reason)
          await page.getByTestId('inline-confirm-action').click()
          await expect.poll(() => cancelRequests).toBe(1)
          await expect.poll(() => refreshRequests).toBe(1)
          if (refreshState === 'failed') {
            finishRefresh()
            await expect(page.locator('[data-slot="error-state"]')).toBeVisible()
          } else {
            await expect(page.locator('[data-slot="loading-skeleton"]')).toBeVisible()
          }
          await page.locator('[data-slot="page-header"] a').first().click()
          await expect(page.getByTestId('unsaved-changes-dialog')).toBeVisible()
          await expect(page).toHaveURL(/\/customers\/cust-beta\?tab=subscription$/)
          await page.getByRole('button', { name: 'البقاء في الصفحة', exact: true }).click()
          await expect(page.getByTestId('unsaved-changes-dialog')).toHaveCount(0)
          await expect(page).toHaveURL(/\/customers\/cust-beta\?tab=subscription$/)
          recoverRefresh = true
          if (refreshState === 'loading') finishRefresh()
          else await page.locator('[data-slot="error-state"]').getByRole('button').click()
          await expect(page.getByLabel('سبب الإلغاء (من 3 إلى 1000 حرف)')).toHaveValue(reason)
          expect(cancelRequests).toBe(1)
        } finally {
          finishRefresh()
        }
      })
    }

    test('a customer with no subscription starts a paid one from its own page and a retry keeps the same order key', async ({ page }) => {
      const { quotes, orders } = await mockOrderFlow(page, [PAID_PLAN], [{ status: 503, body: { code: 'vendor_unavailable', message: 'down' } }, { status: 200, body: { id: 'order-1' } }])
      await open(page, '/customers/cust-gamma?tab=subscription')
      await page.getByTestId('start-first-subscription').click()
      await expect(page).toHaveURL(/\/customers\/cust-gamma\/change/)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('ابدأ اشتراكًا مدفوعًا')
      await pick(page, 'الباقة', 'باقة النمو')
      await pick(page, 'دورة الفوترة', 'شهري')
      await page.getByTestId('onboarding-choice').check()
      await page.getByRole('button', { name: 'احسب السعر' }).click()
      await expect(page.locator('[data-slot="invoice-lines"]')).toBeVisible()
      expect(quotes).toHaveLength(1)
      expect(quotes[0]).toMatchObject({ customer_id: 'cust-gamma', kind: 'new', plan_revision_id: GROWTH.id, expected_subscription_revision: 0, bundle_revision_ids: [CORE_BUNDLE.id], requested_users: 10, requested_storage_mb: 10240, onboarding: true })
      expect(quotes[0]).not.toHaveProperty('subscription_id')
      await page.getByRole('button', { name: 'تأكيد الطلب' }).click()
      await expect.poll(() => orders.length).toBe(1)
      await expect(page.getByRole('button', { name: 'تأكيد الطلب' })).toBeEnabled()
      await page.getByRole('button', { name: 'تأكيد الطلب' }).click()
      await expect.poll(() => orders.length).toBe(2)
      expect(orders[1]).toEqual(orders[0])
      expect(orders[0]).toMatchObject({ quote_id: 'quote-1', expected_subscription_revision: 0 })
      expect(quotes).toHaveLength(1)
    })

    test('the change and terms pages still open as children of the record', async ({ page }) => {
      await open(page, '/customers/cust-alpha/change')
      await expectNoSecondH1(page)
      await expect(page.locator('[data-template="record"]')).toHaveCount(0)
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('the mobile rows carry the same information, J skips the hidden table, nothing overflows', async ({ page }) => {
      await open(page, '/customers')
      await expect(mobileRows(page)).toHaveCount(3)
      await expect(page.locator('table')).toBeHidden()
      await expect(mobileRows(page).first()).toContainText('شركة ألفا')
      await expect(mobileRows(page).first().getByTestId('customer-row')).toBeVisible()
      expect(await fitsWidth(page)).toBe(true)
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(mobileRows(page).nth(0)).toBeFocused()
    })

    test('the record fits the phone width', async ({ page }) => {
      await open(page, '/customers/cust-alpha')
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
