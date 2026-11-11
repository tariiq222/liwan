import { test, expect, type Page } from '@playwright/test'

// The campaign launch path against the shared audit mock (MODULE_UI_PREVIEW=1) and no model: the seeded draft campaign
// opens from its list row, launches after the inline confirmation, and the page then shows the running state with the
// live statistics and the recipients of the send. Inbox campaign routes: e2e/inbox-campaigns-preview-data.mjs.
test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Isolated synthetic API only')
test.setTimeout(90_000)

// The seeded draft of inbox-campaigns-preview-data.mjs: the one campaign that can still be launched.
const DRAFT = { id: 3, name: 'مسودة عروض الشتاء' }

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled({ timeout: 30_000 })
}

test('a draft campaign launches and reports the running state with its figures', async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })).status()).toBe(200)
  // The mock keeps its state for the process: restore the seed so the draft is a draft on every run of this spec.
  expect((await page.request.post('/api/v1/__mock/reset-inbox', { data: {} })).status()).toBe(200)

  // The list opens the campaign's own page from its stable row test id, and it starts as a draft.
  await open(page, '/inbox/campaigns')
  await page.getByTestId(`inbox-campaign-row-${DRAFT.id}`).click()
  await expect(page).toHaveURL(new RegExp(`/inbox/campaigns/${DRAFT.id}(\\?|$)`))
  await expect(page.getByRole('heading', { name: DRAFT.name })).toBeVisible()
  await expect(page.getByTestId('inbox-campaign-state')).toContainText('مسودة')

  // Launch asks inline first; confirming it is what sends the campaign.
  await page.getByTestId('inbox-campaign-launch').click()
  await expect(page.getByTestId('inbox-campaign-confirm')).toBeVisible()
  await page.getByTestId('inline-confirm-action').click()

  // The state becomes running, and the statistics and the recipients of the send are on the page.
  await expect(page.getByTestId('inbox-campaign-state')).toContainText('قيد الإرسال')
  await expect(page.getByTestId('inbox-campaign-stats')).toBeVisible()
  await expect(page.getByTestId('inbox-campaign-recipients')).toBeVisible()
  // The launch created the audience's recipients; a stats card that renders unconditionally would not prove it.
  await expect(page.locator('[data-testid^="inbox-recipient-state-"]').first()).toBeVisible()
})
