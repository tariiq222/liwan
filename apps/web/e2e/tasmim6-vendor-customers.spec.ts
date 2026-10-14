import { expect, test } from '@playwright/test'
import { expectNoSecondH1, fitsWidth, login, mobileRows, open, rows } from './tasmim6-commercial-helpers'

test.describe('Plan 6e: vendor customers', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('the list is the list template with a data table and the same filters', async ({ page }) => {
      await open(page, '/vendor/customers')
      await expectNoSecondH1(page)
      await expect(page.getByRole('heading', { level: 1 })).toContainText('العملاء التجاريون')
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await expect(rows(page)).toHaveCount(3)
      await expect(page.getByTestId('customer-row').filter({ visible: true })).toHaveCount(3)
      await expect(page.getByTestId('setup-required').filter({ visible: true })).toHaveCount(1)
      await expect(page.locator('[data-shortcut-create]')).toHaveCount(0)
      await expect(page.getByTestId('customers-result-count')).toContainText('3')
    })

    test('a state filter keeps the other query keys and an unknown state falls back to all', async ({ page }) => {
      await open(page, '/vendor/customers?state=bogus&q=&source=retained')
      await expect(rows(page)).toHaveCount(3)
      await page.getByRole('button', { name: 'البحث والفلاتر', exact: true }).click()
      await page.getByRole('button', { name: 'مفعّل', exact: true }).click()
      await expect.poll(() => new URL(page.url()).searchParams.get('state')).toBe('active')
      expect(new URL(page.url()).searchParams.get('source')).toBe('retained')
    })

    test('J and K move between rows, Enter opens the record and Back returns to the filtered list', async ({ page }) => {
      await open(page, '/vendor/customers?state=all')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('j')
      await page.keyboard.press('k')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/vendor\/customers\/cust-alpha/)
      expect(new URL(page.url()).searchParams.get('returnTo')).toContain('/vendor/customers')
    })

    test('/ focuses the search', async ({ page }) => {
      await open(page, '/vendor/customers')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('/')
      await expect(page.locator('[data-shortcut-search] input')).toBeFocused()
    })

    test('an unavailable commercial list shows the not-available alert, not an empty table', async ({ page }) => {
      await open(page, '/vendor/overview')
      await page.route('**/api/vendor/v1/commercial/customers**', route => route.fulfill({ status: 501, json: { code: 'not_implemented', message: 'n' } }))
      await page.getByRole('link', { name: 'العملاء التجاريون', exact: true }).last().click()
      await expect(page.locator('[data-slot="data-table"]')).toHaveCount(0)
      await expect(page.getByRole('main')).toContainText('غير متاح')
    })

    test('the record is the record template: one h1, sections as h2, the summary in the aside', async ({ page }) => {
      await open(page, '/vendor/customers/cust-alpha?returnTo=%2Fvendor%2Fcustomers')
      await expectNoSecondH1(page)
      await expect(page.getByRole('heading', { level: 1 })).toContainText('شركة ألفا')
      await expect(page.locator('[data-template="record"]')).toHaveCount(1)
      await expect(page.locator('[data-slot="record-aside"] [data-slot="properties-panel"]')).toHaveCount(1)
      await expect(page.locator('[data-slot="record-section"]').first()).toBeVisible()
      await expect(page.getByTestId('branch-summary')).toBeVisible()
      await expect(page.getByTestId('customer-invoice')).toHaveCount(2)
      await expect(page.getByTestId('usage-meter').first()).toBeVisible()
    })

    test('cancelling a pending order asks inline first and never opens a dialog', async ({ page }) => {
      await open(page, '/vendor/customers/cust-beta')
      await page.getByRole('button', { name: 'إلغاء الطلب المعلّق' }).first().click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByLabel('سبب الإلغاء (من 3 إلى 1000 حرف)')).toBeVisible()
    })

    for (const refreshState of ['loading', 'failed'] as const) {
      test(`a failed cancellation preserves its dirty reason guard during ${refreshState} customer refresh`, async ({ page }) => {
        await open(page, '/vendor/customers/cust-beta')
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
          await expect(page).toHaveURL(/\/vendor\/customers\/cust-beta$/)
          await page.getByRole('button', { name: 'البقاء في الصفحة', exact: true }).click()
          await expect(page.getByTestId('unsaved-changes-dialog')).toHaveCount(0)
          await expect(page).toHaveURL(/\/vendor\/customers\/cust-beta$/)
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

    test('the change and terms pages still open as children of the record', async ({ page }) => {
      await open(page, '/vendor/customers/cust-alpha/change')
      await expectNoSecondH1(page)
      await expect(page.locator('[data-template="record"]')).toHaveCount(0)
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('the mobile rows carry the same information, J skips the hidden table, nothing overflows', async ({ page }) => {
      await open(page, '/vendor/customers')
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
      await open(page, '/vendor/customers/cust-alpha')
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
