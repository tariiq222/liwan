import { test, expect, type Page } from '@playwright/test'

// The limited Customer Messages roles the audit found without an entry to their own channels. The mock grants one
// area capability and no channel administration (apps/web/e2e/mock-capabilities.mjs); the server's own refusal is
// covered by the liwan_inbox Odoo tests.
async function signIn(page: Page, capabilities: string) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.context().addCookies([{ name: 'mock_caps', value: capabilities, url: new URL(page.url()).origin }])
  expect((await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })).status()).toBe(200)
}

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled({ timeout: 30_000 })
}

test('a templates manager reaches the channels it can work on, without channel administration', async ({ page }) => {
  await signIn(page, 'inbox_templates')
  await open(page, '/settings/apps/inbox#channels')

  const workRow = page.getByTestId('inbox-work-channel-1')
  await expect(workRow).toBeVisible()
  await expect(page.getByTestId('inbox-work-templates-1')).toBeVisible()
  // Channel administration stays closed: no admin row, no connect button, and no forms entry without that capability.
  await expect(page.getByTestId('inbox-channel-1')).toHaveCount(0)
  await expect(page.getByTestId('inbox-channel-connect')).toHaveCount(0)
  await expect(page.getByTestId('inbox-work-flows-1')).toHaveCount(0)

  await page.getByTestId('inbox-work-templates-1').click()
  await expect(page).toHaveURL(/\/settings\/apps\/inbox\/channels\/1\/templates$/)
  await expect(page.getByText('appointment_reminder')).toBeVisible({ timeout: 30_000 })
})

test('a forms manager reaches the forms of a channel, without channel administration', async ({ page }) => {
  await signIn(page, 'inbox_flows')
  await open(page, '/settings/apps/inbox#channels')

  await expect(page.getByTestId('inbox-work-channel-1')).toBeVisible()
  await expect(page.getByTestId('inbox-work-flows-1')).toBeVisible()
  await expect(page.getByTestId('inbox-work-templates-1')).toHaveCount(0)
  await expect(page.getByTestId('inbox-channel-1')).toHaveCount(0)

  await page.getByTestId('inbox-work-flows-1').click()
  await expect(page).toHaveURL(/\/settings\/apps\/inbox\/channels\/1\/flows$/)
  await expect(page.getByText('طلب موعد').first()).toBeVisible({ timeout: 30_000 })
})

test('a reader with no channel work capability gets no channels entry', async ({ page }) => {
  await signIn(page, 'reader')
  await open(page, '/settings/apps/inbox')
  // The channels card opens for channel administration or one of the three work capabilities; a reader holds none of
  // them, so neither the settings page nor the reference list is offered.
  await expect(page.getByTestId('inbox-settings')).toHaveCount(0)
  await expect(page.getByTestId('inbox-work-channel-1')).toHaveCount(0)
  await expect(page.getByTestId('inbox-channel-connect')).toHaveCount(0)
})
