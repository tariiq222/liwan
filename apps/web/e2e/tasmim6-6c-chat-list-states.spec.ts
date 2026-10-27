import { expect, test, type Page } from '@playwright/test'

test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Isolated synthetic API only')

// Plan 6c: the conversation list states. The mock API serves no chat, so every chat request is answered here
// (the chat queries are client-only, so the page.route handler sees all of them).
const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
async function login(page: Page) {
  const response = await page.request.post('/api/auth/login', { data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD } })
  expect(response.status()).toBe(200)
}
async function open(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled({ timeout: 20_000 })
}
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

const conversation = { id: 42, type: 'group', name: 'محادثة تجريبية', unread_count: 0, last_message_at: '2026-09-09T10:00:00Z', last_message_preview: 'رسالة ثانية', member_count: 2, muted: false, notifications: null, peer_seen_message_id: null, im_status: null, can_manage: true, can_remove_members: false }
type ListMode = { items: unknown[]; status: number; delayMs: number }

async function mockChat(page: Page, mode: ListMode) {
  await page.route('**/api/v1/chat/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/conversations') && route.request().method() === 'GET') {
      if (mode.delayMs) await new Promise(resolve => setTimeout(resolve, mode.delayMs))
      const body = mode.status === 200 ? { items: mode.items, total: mode.items.length } : { code: 'server_error', message: 'Synthetic failure' }
      return route.fulfill({ status: mode.status, contentType: 'application/json', body: JSON.stringify(body) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0 }) })
  })
}

test.describe('Plan 6c: the conversation list states', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test.beforeEach(async ({ page }) => { await login(page) })

  test('a first load shows the shared skeleton, then the conversations', async ({ page }) => {
    await mockChat(page, { items: [conversation], status: 200, delayMs: 1500 })
    await open(page, '/chat')
    const list = page.getByTestId('chat-list')
    await expect(list.locator('[data-slot="loading-skeleton"]')).toBeVisible()
    await expect(list.getByRole('link', { name: /محادثة تجريبية/ })).toBeVisible({ timeout: 15_000 })
    await expect(list.locator('[data-slot="loading-skeleton"]')).toHaveCount(0)
  })

  test('no conversations shows the empty sentence, a search with no match shows the filtered one', async ({ page }) => {
    await mockChat(page, { items: [], status: 200, delayMs: 0 })
    await open(page, '/chat')
    const list = page.getByTestId('chat-list')
    await expect(list.getByText('لا محادثات بعد.')).toBeVisible()
    await list.getByPlaceholder('بحث في المحادثات').fill('zzz')
    await page.keyboard.press('Enter')
    await expect(list.getByText('لا محادثات تطابق هذا البحث.')).toBeVisible()
  })

  test('a failed load shows the shared error and retry brings the list back', async ({ page }) => {
    const mode: ListMode = { items: [conversation], status: 500, delayMs: 0 }
    await mockChat(page, mode)
    await open(page, '/chat')
    const list = page.getByTestId('chat-list')
    const error = list.locator('[data-slot="error-state"]')
    await expect(error).toBeVisible({ timeout: 15_000 })
    await expect(error).toHaveAttribute('role', 'alert')
    mode.status = 200
    await error.getByRole('button', { name: 'إعادة المحاولة', exact: true }).click()
    await expect(list.getByRole('link', { name: /محادثة تجريبية/ })).toBeVisible()
    await expect(error).toHaveCount(0)
  })

  test('the phone list keeps its one h1, the toolbar and fits the width', async ({ page }) => {
    await mockChat(page, { items: [conversation], status: 200, delayMs: 0 })
    await open(page, '/chat')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('المحادثة')
    await expect(page.getByTestId('chat-list').getByRole('button', { name: 'جديد', exact: true })).toBeVisible()
    expect(await fitsWidth(page)).toBe(true)
  })
})
