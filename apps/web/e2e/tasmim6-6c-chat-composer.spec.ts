import { expect, test, type Page, type Route } from '@playwright/test'

test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Isolated synthetic API only')

// Plan 6c: the composer and the message list on the existing workspace (isolated mock stack).

const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
async function login(page: Page) {
  const response = await page.request.post('/api/auth/login', { data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD } })
  expect(response.status()).toBe(200)
}
async function open(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
}
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

const conversation = { id: 42, type: 'group', name: 'محادثة تجريبية', unread_count: 0, last_message_at: '2026-09-09T10:00:00Z', last_message_preview: 'رسالة ثانية', member_count: 2, muted: false, notifications: null, peer_seen_message_id: null, im_status: null, can_manage: true, can_remove_members: false }
const message = (id: number, body: string) => ({ id, conversation_id: 42, author: { id: 7, name: 'سارة' }, body, created_at: '2026-09-09T10:00:00Z', attachments: [], parent: null, edited: false, deleted: false, pinned: false, starred: false, reactions: [], notice: null })
const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

type Mode = { messages: number; send: number }

async function mockChat(page: Page, mode: Mode) {
  const sent: unknown[] = []
  await page.route('**/api/v1/chat/**', async route => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (url.pathname.endsWith('/messages') && method === 'POST') {
      sent.push(route.request().postDataJSON())
      return mode.send === 201 ? json(route, 201, message(99, String((sent.at(-1) as { body?: string }).body ?? ''))) : json(route, mode.send, { code: 'server_error', message: 'Synthetic failure' })
    }
    if (url.pathname.endsWith('/messages')) {
      return mode.messages === 200 ? json(route, 200, { items: [message(1, 'رسالة أولى')], total: 1 }) : json(route, mode.messages, { code: 'server_error', message: 'Synthetic failure' })
    }
    if (url.pathname.endsWith('/conversations')) return json(route, 200, { items: [conversation], total: 1 })
    if (/\/42(\/read)?$/.test(url.pathname)) return json(route, 200, conversation)
    return json(route, 200, { items: [], total: 0 })
  })
  return sent
}

test.describe('Plan 6c: the composer and the message list', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeEach(async ({ page }) => { await login(page) })

  test('a sent message clears the draft', async ({ page }) => {
    const sent = await mockChat(page, { messages: 200, send: 201 })
    await open(page, '/chat/42')
    const box = page.getByPlaceholder('اكتب رسالة')
    await box.fill('مرحبا بالجميع')
    await page.getByRole('button', { name: 'إرسال' }).click()
    await expect(box).toHaveValue('')
    expect(sent).toEqual([{ body: 'مرحبا بالجميع' }])
  })

  test('a failed send keeps the draft in the box', async ({ page }) => {
    await mockChat(page, { messages: 200, send: 500 })
    await open(page, '/chat/42')
    const box = page.getByPlaceholder('اكتب رسالة')
    await box.fill('لن تُرسل')
    await page.getByRole('button', { name: 'إرسال' }).click()
    await expect(box).toHaveValue('لن تُرسل')
    await expect(page.getByRole('button', { name: 'إرسال' })).toBeEnabled()
  })

  test('a failed message load shows the shared error with the chat sentence, and retry loads them', async ({ page }) => {
    const mode: Mode = { messages: 500, send: 201 }
    await mockChat(page, mode)
    await open(page, '/chat/42')
    const thread = page.getByTestId('chat-thread')
    await expect(thread.getByRole('alert')).toContainText('هذه المحادثة غير متاحة.', { timeout: 15_000 })
    mode.messages = 200
    await thread.getByRole('button', { name: 'إعادة المحاولة' }).click()
    await expect(page.locator('[data-message-id]')).toHaveCount(1)
    await expect(thread.getByRole('alert')).toHaveCount(0)
  })

  test('the composer fits a 390px phone', async ({ page }) => {
    await mockChat(page, { messages: 200, send: 201 })
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page, '/chat/42')
    await expect(page.getByPlaceholder('اكتب رسالة')).toBeVisible()
    expect(await fitsWidth(page)).toBe(true)
  })
})
