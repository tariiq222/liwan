import { expect, test } from '@playwright/test'
import { expectNoSecondH1, fitsWidth, login, navigateClient, open } from './commercial-helpers'

test.describe('Plan 6e: the vendor overview', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('is the dashboard template with the queue tiles, the commercial block and the shortcuts', async ({ page }) => {
      await open(page, '/overview')
      await expectNoSecondH1(page)
      await expect(page.locator('[data-template="dashboard-page"]')).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toContainText('إدارة نسق')
      await expect(page.getByTestId('metric-tile')).toHaveCount(10)
      await expect(page.getByTestId('commercial-metrics').getByRole('heading', { level: 2 })).toHaveCount(1)
      await expect(page.getByRole('link', { name: 'الفواتير' }).first()).toBeVisible()
    })

    test('an unreachable commercial list keeps the queue tiles and says the block is unavailable', async ({ page }) => {
      await open(page, '/customers')
      await page.route('**/api/vendor/v1/commercial/customers**', route => route.fulfill({ status: 503, json: { code: 'vendor_unavailable', message: 'down' } }))
      await navigateClient(page, '/overview')
      await expect(page.getByTestId('metric-tile')).toHaveCount(4)
      await expect(page.getByTestId('commercial-metrics')).toContainText('غير متاح')
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
