import { test, expect, type Page } from '@playwright/test'

// A provider may have accepted a reply while the local result could not be stored. The message must read as unconfirmed
// and must not be sent again on its own; the operator decides through the explicit retry. The server's send path and its
// no-automatic-resend guarantee are covered by liwan_inbox's Odoo tests; this checks the operator-facing state.
const failed = {
  id: 77, direction: 'out', kind: 'text', body: 'رد لم تتأكد نتيجته', author: { id: 2, name: 'Admin' }, template: null, campaign: null,
  delivery_state: 'failed', error: 'the send result could not be stored', error_code: null, unconfirmed: true,
  attachments: [], reply_to: null, reactions: { customer: null, agent: null }, location: null, interactive: null,
  selected_option: null, flow_response: null, automated: false, commerce: null, created_at: '2026-11-11T08:00:00Z',
}

async function signIn(page: Page) {
  expect((await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })).status()).toBe(200)
}

test('an unconfirmed send is explained and only the explicit retry sends it again', async ({ page }) => {
  const retries: string[] = []
  await page.route('**/api/v1/inbox/conversations/1/messages**', async route => {
    if (route.request().method() !== 'GET') return route.continue()
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [failed], total: 1 }) })
  })
  await page.route('**/api/v1/inbox/messages/77/retry', async route => {
    retries.push(route.request().url())
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...failed, delivery_state: 'queued', unconfirmed: false, error: null }) })
  })

  await signIn(page)
  // Open from the list so the thread's first read is a client request the route intercepts; a direct URL would render
  // the mock's own server-side messages instead.
  await page.goto('/inbox', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('inbox-conversation-1')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('inbox-conversation-1').click()
  await expect(page).toHaveURL(/\/inbox\/1/)
  await expect(page.getByTestId('inbox-thread-scroller')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('لم تؤكد Meta إرسال الرسالة', { exact: false })).toBeVisible()
  // Nothing was retried on load.
  expect(retries).toHaveLength(0)

  await page.getByRole('button', { name: 'إعادة المحاولة' }).click()
  await expect.poll(() => retries.length).toBe(1)
})
