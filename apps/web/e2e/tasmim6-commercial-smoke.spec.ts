import { expect, test } from '@playwright/test'
import { expectNoSecondH1, login, open } from './tasmim6-commercial-helpers'

// Plan 6e wave 1: proves the stub control plane, both BFFs and both gates work before any page moves.
test.describe('Plan 6e: the commercial stack', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test('the vendor BFF answers context and a list through the stub control plane', async ({ page }) => {
    await open(page, '/vendor/customers')
    const context = await page.request.get('/api/vendor/v1/context')
    expect(context.status()).toBe(200)
    expect((await context.json()).capabilities).toContain('vendor.billing.manage')
    const list = await page.request.get('/api/vendor/v1/commercial/customers?limit=25&offset=0')
    expect((await list.json()).total).toBe(3)
  })

  test('the vendor overview and the subscription page load behind their gates', async ({ page }) => {
    await open(page, '/vendor/overview')
    await expectNoSecondH1(page)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('إدارة نسق')
    await open(page, '/subscription')
    await expectNoSecondH1(page)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('اشتراكنا')
  })

  test('a mutation from another origin is still refused by the vendor BFF', async ({ page }) => {
    const response = await page.request.post('/api/vendor/v1/commercial/customer-quotes', { data: {}, headers: { origin: 'https://evil.example' } })
    expect(response.status()).toBe(403)
  })
})
