import { expect, test } from '@playwright/test'

// Plan 6d: /invite/accept on SharedStandalonePage (public page; the accept call is fulfilled in the browser).
test.describe('Plan 6d: accepting an invitation', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('a missing token shows the invalid alert under one heading in a standalone card', async ({ page }) => {
    await page.goto('/invite/accept')
    await expect(page.locator('main')).toHaveCount(1)
    await expect(page.locator('[data-template="standalone-page"][data-variant="card"]')).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.locator('form')).toHaveCount(0)
  })

  test('the form disables submit until the rules pass, then shows success with a sign-in link', async ({ page }) => {
    await page.route('**/api/invitations/accept', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"login":"sara"}' }))
    await page.goto('/invite/accept?token=abc')
    await page.waitForFunction(() => { const app = (window as unknown as { useNuxtApp?: () => { isHydrating: boolean } }).useNuxtApp; return typeof app === 'function' && !app().isHydrating })
    const submit = page.locator('form button[type="submit"]')
    await expect(submit).toBeDisabled()
    await page.locator('#password').fill('Short-1')
    await page.locator('#confirm').fill('Short-1')
    await expect(submit).toBeDisabled()
    await page.locator('#password').fill('A-long-enough-secret-1')
    await page.locator('#confirm').fill('A-long-enough-secret-1')
    await expect(submit).toBeEnabled({ timeout: 20_000 })
    await submit.click()
    await expect(page.getByRole('status')).toBeVisible()
    await expect(page.getByRole('link').last()).toHaveAttribute('href', /\/login\?login=sara/)
  })

  test('an unavailable service shows its own alert', async ({ page }) => {
    await page.route('**/api/invitations/accept', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }))
    await page.goto('/invite/accept?token=abc')
    await page.waitForFunction(() => { const app = (window as unknown as { useNuxtApp?: () => { isHydrating: boolean } }).useNuxtApp; return typeof app === 'function' && !app().isHydrating })
    await page.locator('#password').fill('A-long-enough-secret-1')
    await page.locator('#confirm').fill('A-long-enough-secret-1')
    await expect(page.locator('form button[type="submit"]')).toBeEnabled({ timeout: 20_000 })
    await page.locator('form button[type="submit"]').click()
    await expect(page.getByRole('alert')).toBeVisible()
  })

  test('on a 390px phone the card fits the width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/invite/accept?token=abc')
    await page.waitForFunction(() => { const app = (window as unknown as { useNuxtApp?: () => { isHydrating: boolean } }).useNuxtApp; return typeof app === 'function' && !app().isHydrating })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
