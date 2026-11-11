import { test, expect, type Page } from '@playwright/test'

// A tenant that switched a Customer Messages sub-feature off must not be offered an entry its server refuses. The mock
// closes the named key for the request through the `mock_feature_off` cookie (apps/web/e2e/mock-capabilities.mjs); the
// addon's own 403 `feature_not_included` refusals are covered by liwan_inbox's Odoo tests.
async function signIn(page: Page, featuresOff: string) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.context().addCookies([{ name: 'mock_feature_off', value: featuresOff, url: new URL(page.url()).origin }])
  expect((await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })).status()).toBe(200)
}

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled({ timeout: 30_000 })
}

test('with the features on, the automation editor and templates entry are offered', async ({ page }) => {
  // The positive control: the absence assertions below are only meaningful when the entries exist with the features on.
  expect((await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })).status()).toBe(200)
  await open(page, '/settings/apps/inbox/working-hours')
  await expect(page.getByTestId('inbox-hours-form')).toBeVisible()
  await open(page, '/settings/apps/inbox/channels/1')
  await expect(page.getByTestId('inbox-channel-templates')).toBeVisible()
})

test('automation off: its settings pages and entries disappear', async ({ page }) => {
  await signIn(page, 'inbox.automation')
  await open(page, '/settings/apps/inbox')
  await expect(page.getByTestId('inbox-settings')).toBeVisible()
  // The automation area registers its own pages: with the sub-feature off they are neither in the sidebar nor offered.
  await expect(page.getByRole('link', { name: 'ساعات العمل' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'قواعد الرد الآلي' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'الرسائل الآلية' })).toHaveCount(0)
  // The route guard closes the page itself with the plan notice, instead of rendering an editor the server would refuse.
  await page.goto('/settings/apps/inbox/working-hours', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'هذه الصفحة غير متاحة في باقتك' })).toBeVisible({ timeout: 30_000 })
})

test('templates off: the channel offers no templates entry or tab', async ({ page }) => {
  await signIn(page, 'inbox.templates')
  await open(page, '/settings/apps/inbox/channels/1')
  await expect(page.getByTestId('inbox-channel-test')).toBeVisible()
  await expect(page.getByTestId('inbox-channel-templates')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'القوالب' })).toHaveCount(0)
})

test('forms off: the channel offers no forms entry', async ({ page }) => {
  await signIn(page, 'inbox.flows')
  await open(page, '/settings/apps/inbox/channels/1')
  await expect(page.getByTestId('inbox-channel-test')).toBeVisible()
  await expect(page.getByTestId('inbox-channel-flows')).toHaveCount(0)
})

test('WhatsApp off: no connect button for a new number', async ({ page }) => {
  await signIn(page, 'inbox.whatsapp')
  await open(page, '/settings/apps/inbox#channels')
  await expect(page.getByTestId('inbox-channel-connect')).toHaveCount(0)
})

test('TikTok off: no TikTok connect entry', async ({ page }) => {
  await signIn(page, 'inbox.tiktok')
  await open(page, '/settings/apps/inbox#channels')
  await expect(page.getByRole('button', { name: 'ربط TikTok' })).toHaveCount(0)
})

test('campaigns off: no campaign navigation entry', async ({ page }) => {
  await signIn(page, 'inbox.campaigns')
  await open(page, '/inbox')
  await expect(page.getByTestId('inbox-list')).toBeVisible()
  await expect(page.getByRole('link', { name: 'الحملات' })).toHaveCount(0)
})
