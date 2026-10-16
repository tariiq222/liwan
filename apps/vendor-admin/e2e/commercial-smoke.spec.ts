import { expect, test } from '@playwright/test'
import { expectNoSecondH1, login, open } from './commercial-helpers'

// Proves the stub control plane, the BFF and the console gate work together.
test.describe('Plan 6e: the vendor admin stack', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test('the vendor BFF answers context and a list through the stub control plane', async ({ page }) => {
    await open(page, '/customers')
    const context = await page.request.get('/api/vendor/v1/context')
    expect(context.status()).toBe(200)
    expect((await context.json()).capabilities).toContain('vendor.billing.manage')
    const list = await page.request.get('/api/vendor/v1/commercial/customers?limit=25&offset=0')
    expect((await list.json()).total).toBe(3)
  })

  test('the vendor overview loads behind its gate', async ({ page }) => {
    await open(page, '/overview')
    await expectNoSecondH1(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('اليوم')
  })

  test('a mutation from another origin is still refused by the vendor BFF', async ({ page }) => {
    const response = await page.request.post('/api/vendor/v1/commercial/customer-quotes', { data: {}, headers: { origin: 'https://evil.example' } })
    expect(response.status()).toBe(403)
  })
})
