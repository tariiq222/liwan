import { test, expect, type Page } from '@playwright/test'

// A delivery the worker stopped after its attempts: the channel health page lists it, and the operator can give it a
// fresh set of attempts. The mock's event is seeded in apps/web/e2e/inbox-ui-preview-data.mjs; the server's own route
// and the "good items are not applied twice" rule are covered by liwan_inbox's Odoo tests.
async function signIn(page: Page) {
  expect((await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })).status()).toBe(200)
}

test('a failed delivery is shown on the channel health page and can be retried', async ({ page }) => {
  await signIn(page)
  await page.goto('/settings/apps/inbox/channels/1/health', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled({ timeout: 30_000 })

  const row = page.getByTestId('inbox-health-delivery-901')
  await expect(row).toBeVisible()
  await expect(row).toContainText('المحاولات: 5')

  await page.getByTestId('inbox-health-delivery-retry-901').click()
  // The retry moves it back to the queue, so it leaves the failed list.
  await expect(page.getByTestId('inbox-health-delivery-901')).toHaveCount(0)
  await expect(page.getByTestId('inbox-health-deliveries-empty')).toBeVisible()
})
