import { expect, test, type Page, type Route } from '@playwright/test'

test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Isolated synthetic API only')

// Plan 6c: the conversation info body, as the standalone info page shows it (isolated mock stack).
const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
async function login(page: Page) {
  const response = await page.request.post('/api/auth/login', { data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD } })
  expect(response.status()).toBe(200)
}
async function open(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled({ timeout: 30_000 })
}
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

const conversation = { id: 42, type: 'group', name: 'محادثة تجريبية', unread_count: 0, last_message_at: '2026-09-09T10:00:00Z', last_message_preview: 'رسالة ثانية', member_count: 2, muted: false, notifications: null, peer_seen_message_id: null, im_status: null, can_manage: true, can_remove_members: false }
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

async function mockChat(page: Page) {
  const patches: unknown[] = []
  await page.route('**/api/v1/chat/**', async route => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (url.pathname.endsWith('/members')) return json(route, { items: [{ id: 7, name: 'سارة', im_status: 'online' }, { id: 8, name: 'خالد', im_status: null }], total: 2 })
    if (url.pathname.endsWith('/attachments')) return json(route, { items: [{ id: 5, name: 'الهيكل.pdf', mimetype: 'application/pdf', url: '/api/v1/attachments/5' }], total: 1 })
    if (url.pathname.endsWith('/recipients')) return json(route, { items: [{ id: 9, name: 'منى' }], total: 1 })
    if (/\/conversations\/42$/.test(url.pathname) && method === 'PATCH') { patches.push(route.request().postDataJSON()); return json(route, { ...conversation, muted: true }) }
    if (url.pathname.endsWith('/conversations')) return json(route, { items: [conversation], total: 1 })
    if (/\/42(\/read)?$/.test(url.pathname)) return json(route, conversation)
    return json(route, { items: [], total: 0 })
  })
  return patches
}

test.describe('Plan 6c: the conversation info body', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeEach(async ({ page }) => { await login(page) })

  test('the info page shows its one heading and the five sections', async ({ page }) => {
    await mockChat(page)
    await open(page, '/chat/42/info')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('محادثة تجريبية')
    const info = page.getByTestId('chat-info')
    for (const title of ['الاسم', 'الإشعارات', 'الأعضاء', 'المرفقات']) await expect(info.getByRole('heading', { name: title })).toBeVisible()
    await expect(info.getByText('سارة')).toBeVisible()
    await expect(info.getByText('خالد')).toBeVisible()
    await expect(info.getByRole('link', { name: /الهيكل\.pdf/ })).toBeVisible()
    await expect(page.getByRole('link', { name: 'رجوع' })).toHaveAttribute('href', /\/chat\/42/)
  })

  test('muting sends one PATCH with the new value', async ({ page }) => {
    const patches = await mockChat(page)
    await open(page, '/chat/42/info')
    await page.getByTestId('chat-info').getByRole('button', { name: 'مكتومة' }).click()
    await expect.poll(() => patches).toEqual([{ muted: true }])
  })

  test('leaving asks inline first and cancel changes nothing', async ({ page }) => {
    await mockChat(page)
    await open(page, '/chat/42/info')
    const info = page.getByTestId('chat-info')
    await info.getByRole('button', { name: 'مغادرة المحادثة' }).click()
    await expect(info.getByText('مغادرة هذه المحادثة؟')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await info.getByRole('button', { name: 'إلغاء' }).click()
    await expect(info.getByText('مغادرة هذه المحادثة؟')).toHaveCount(0)
    await expect(info.getByRole('button', { name: 'مغادرة المحادثة' })).toBeVisible()
  })

  test('the info page fits a 390px phone', async ({ page }) => {
    await mockChat(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page, '/chat/42/info')
    await expect(page.getByTestId('chat-info')).toBeVisible()
    expect(await fitsWidth(page)).toBe(true)
  })
})
