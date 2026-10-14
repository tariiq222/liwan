import { expect, test, type Page, type Route } from '@playwright/test'

test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Isolated synthetic API only')

// Plan 6c: the chat workspace on SharedConversationLayout (isolated mock stack; chat requests are answered here).
import { login, open, fitsWidth } from './support/tasmim6'
const conversation = { id: 42, type: 'group', name: 'محادثة تجريبية', unread_count: 0, last_message_at: '2026-09-09T10:00:00Z', last_message_preview: 'رسالة ثانية', member_count: 2, muted: false, notifications: null, peer_seen_message_id: null, im_status: null, can_manage: true }
const message = (id: number, body: string) => ({ id, conversation_id: 42, author: { id: 7, name: 'سارة' }, body, created_at: '2026-09-09T10:00:00Z', attachments: [], parent: null, edited: false, pinned: false, starred: false, reactions: [] })
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

async function mockChat(page: Page, options: { denied?: boolean; historyLength?: number; second?: boolean } = {}) {
  const sent: { conversationId: number; payload: unknown }[] = []
  await page.route('**/api/v1/chat/**', async route => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    const id = Number(/\/conversations\/(\d+)/.exec(url.pathname)?.[1] ?? 42)
    const current = id === 43 ? { ...conversation, id: 43, name: 'محادثة أخرى' } : conversation
    if (url.pathname.endsWith('/messages') && method === 'POST') {
      const payload = route.request().postDataJSON()
      sent.push({ conversationId: id, payload })
      return json(route, { ...message(99, String(payload.body ?? '')), conversation_id: id }, 201)
    }
    if (url.pathname.endsWith('/messages') && method === 'GET') {
      const items = options.historyLength
        ? Array.from({ length: options.historyLength }, (_, index) => ({ ...message(index + 1, `رسالة ${index + 1}`), conversation_id: id }))
        : [message(1, 'رسالة أولى'), message(2, 'رسالة ثانية')].map(item => ({ ...item, conversation_id: id }))
      return json(route, { items, total: items.length })
    }
    if (url.pathname.endsWith('/members')) return json(route, { items: [{ id: 7, name: 'سارة', im_status: 'online' }], total: 1 })
    if (url.pathname.endsWith('/attachments')) return json(route, { items: [], total: 0 })
    if (url.pathname.endsWith('/conversations')) {
      const items = options.second ? [conversation, { ...conversation, id: 43, name: 'محادثة أخرى' }] : [conversation]
      return json(route, { items, total: items.length })
    }
    if (/\/(42|43)(\/read)?$/.test(url.pathname)) return options.denied ? json(route, { code: 'forbidden', message: 'forbidden' }, 403) : json(route, current)
    return json(route, { items: [], total: 0 })
  })
  return sent
}
const composer = (page: Page) => page.getByPlaceholder('اكتب رسالة')
const infoButton = (page: Page) => page.getByTestId('chat-thread-header').getByRole('link', { name: 'معلومات المحادثة' })

test.describe('Plan 6c: the chat workspace', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('/chat is the conversation layout with the empty state, one h1 and the list in the sidebar', async ({ page }) => {
      await mockChat(page)
      await open(page, '/chat')
      await expect(page.locator('[data-template="conversation-layout"]')).toHaveCount(1)
      await expect(page.locator('[data-template="conversation-empty"]')).toContainText('اختر محادثة')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('المحادثة')
      await expect(page.getByTestId('chat-list')).toBeVisible()
      await expect(page.getByTestId('chat-thread')).toHaveCount(0)
    })

    test('/chat/42 shows the header, the messages and the composer in their regions', async ({ page }) => {
      await mockChat(page)
      await open(page, '/chat/42')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.locator('[data-template="conversation-header"]').getByRole('heading', { level: 1 })).toHaveText('محادثة تجريبية')
      await expect(page.getByTestId('chat-thread-header')).toBeVisible()
      await expect(page.getByTestId('chat-thread').locator('[data-message-id]')).toHaveCount(2)
      await expect(page.locator('[data-template="conversation-composer"]')).toBeVisible()
      await expect(composer(page)).toBeVisible()
      await expect(page.locator('[data-template="conversation-info"]')).toHaveCount(0)
      await expect(infoButton(page)).toHaveAttribute('aria-pressed', 'false')
    })

    for (const width of [768, 1024]) {
      test(`at ${width}px info uses the available region and closing it restores the unsent draft`, async ({ page }, testInfo) => {
        const sent = await mockChat(page, { historyLength: 40 })
        await page.setViewportSize({ width, height: 900 })
        await open(page, '/chat/42?filter=unread')
        const scroller = page.getByTestId('chat-scroller')
        await expect(page.locator('[data-message-id]')).toHaveCount(40)
        await scroller.evaluate(node => { node.setAttribute('data-probe', 'tablet-scroller'); node.scrollTop = 80 })
        await composer(page).fill('مسودة محفوظة عند عرض المعلومات')
        await infoButton(page).click()
        const info = page.locator('[data-template="conversation-info"]')
        await expect(info).toBeVisible()
        await expect(page.getByTestId('chat-thread')).toBeHidden()
        await expect(composer(page)).toBeHidden()
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
        await expect(info.getByRole('heading', { level: 1 })).toHaveText('معلومات المحادثة')
        expect((await info.boundingBox())?.width).toBeGreaterThan(300)
        expect(await fitsWidth(page)).toBe(true)
        await page.screenshot({ path: testInfo.outputPath(`chat-info-${width}.png`) })
        await info.getByRole('link', { name: 'رجوع', exact: true }).click()
        await expect(page).toHaveURL(/\/chat\/42\?(?=.*filter=unread)/)
        await expect(composer(page)).toHaveValue('مسودة محفوظة عند عرض المعلومات')
        await expect(scroller).toHaveAttribute('data-probe', 'tablet-scroller')
        await expect.poll(() => scroller.evaluate(node => node.scrollTop)).toBe(80)
        expect(sent).toEqual([])
      })
    }

    test('the message search toggles from the thread header', async ({ page }) => {
      await mockChat(page)
      await open(page, '/chat/42')
      await page.getByTestId('chat-thread-header').getByRole('button', { name: 'بحث في الرسائل' }).click()
      await expect(page.getByTestId('chat-thread-header').getByPlaceholder('بحث في الرسائل')).toBeVisible()
    })

    test('the info panel opens beside the thread without remounting it, keeps the draft, and closes', async ({ page }) => {
      const sent = await mockChat(page, { historyLength: 40 })
      await open(page, '/chat/42?filter=unread')
      await composer(page).fill('مسودة لم تُرسل')
      await page.getByTestId('chat-thread').evaluate(node => { node.setAttribute('data-probe', 'same-node') })
      const scroller = page.getByTestId('chat-scroller')
      await expect(page.locator('[data-message-id]')).toHaveCount(40)
      await scroller.evaluate(node => { node.setAttribute('data-probe', 'same-scroller'); node.scrollTop = 80 })
      await expect.poll(() => scroller.evaluate(node => node.scrollTop)).toBe(80)
      await infoButton(page).click()
      await expect(page).toHaveURL(/\/chat\/42\/info\?(?=.*filter=unread)/)
      const info = page.locator('[data-template="conversation-info"]')
      await expect(info).toBeVisible()
      await expect(info.getByRole('heading', { level: 2, name: 'معلومات المحادثة' })).toBeVisible()
      await expect(info.getByTestId('chat-info')).toContainText('سارة')
      await expect(page.getByTestId('chat-thread')).toBeVisible()
      await expect(page.getByTestId('chat-thread')).toHaveAttribute('data-probe', 'same-node')
      await expect(composer(page)).toHaveValue('مسودة لم تُرسل')
      await expect(scroller).toHaveAttribute('data-probe', 'same-scroller')
      await expect.poll(() => scroller.evaluate(node => node.scrollTop)).toBe(80)
      await expect(infoButton(page)).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await info.getByRole('link', { name: 'رجوع' }).click()
      await expect(page).toHaveURL(/\/chat\/42\?(?=.*filter=unread)/)
      await expect(info).toHaveCount(0)
      await expect.poll(() => scroller.evaluate(node => node.scrollTop)).toBe(80)
      expect(sent).toEqual([])
      await expect(composer(page)).toHaveValue('مسودة لم تُرسل')
    })

    test('Escape closes the panel, a direct link opens it, and Back leaves it', async ({ page }) => {
      await mockChat(page)
      await open(page, '/chat/42/info')
      await expect(page.locator('[data-template="conversation-info"]')).toBeVisible()
      await expect(page.getByTestId('chat-thread')).toBeVisible()
      await page.getByTestId('chat-thread-header').getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('Escape')
      await expect(page).toHaveURL(/\/chat\/42(\?|$)/)
      await expect(page.locator('[data-template="conversation-info"]')).toHaveCount(0)
      await infoButton(page).click()
      await expect(page).toHaveURL(/\/chat\/42\/info/)
      await page.goBack()
      await expect(page.locator('[data-template="conversation-info"]')).toHaveCount(0)
    })


    test('switching conversations clears the previous draft, mentions and message search', async ({ page }) => {
      const sent = await mockChat(page, { second: true })
      await open(page, '/chat/42')
      await composer(page).fill('@')
      await page.locator('form.nasq-chat-composer').getByRole('button', { name: 'سارة', exact: true }).click()
      await page.getByTestId('chat-thread-header').getByRole('button', { name: 'بحث في الرسائل' }).click()
      await page.getByPlaceholder('بحث في الرسائل').fill('رسالة')
      await page.getByTestId('chat-list').getByRole('link', { name: /محادثة أخرى/ }).click()
      await expect(page).toHaveURL(/\/chat\/43/)
      await expect(composer(page)).toHaveValue('')
      await expect(page.getByPlaceholder('بحث في الرسائل')).toHaveCount(0)
      await composer(page).fill('رسالة للمحادثة الجديدة')
      await page.getByRole('button', { name: 'إرسال', exact: true }).click()
      await expect.poll(() => sent).toEqual([{ conversationId: 43, payload: { body: 'رسالة للمحادثة الجديدة' } }])
      await page.getByTestId('chat-list').getByRole('link', { name: /محادثة تجريبية/ }).click()
      await expect(page).toHaveURL(/\/chat\/42/)
      await expect(composer(page)).toHaveValue('')
    })

    test('an unknown panel segment is a 404', async ({ page }) => {
      await mockChat(page)
      const response = await page.goto('/chat/42/other')
      expect(response?.status()).toBe(404)
    })

    test('a conversation the user cannot read shows the unavailable state with no header and no composer', async ({ page }) => {
      await mockChat(page, { denied: true })
      await open(page, '/chat/42')
      await expect(page.getByTestId('chat-thread')).toContainText('هذه المحادثة غير متاحة.')
      await expect(page.getByTestId('chat-thread-header')).toHaveCount(0)
      await expect(composer(page)).toHaveCount(0)
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('the list fills /chat, the thread fills /chat/42 and its back control returns to the list', async ({ page }) => {
      await mockChat(page)
      await open(page, '/chat')
      await expect(page.getByTestId('chat-list')).toBeVisible()
      await expect(page.getByTestId('chat-thread')).toHaveCount(0)
      expect(await fitsWidth(page)).toBe(true)
      await open(page, '/chat/42')
      await expect(page.getByTestId('chat-thread')).toBeVisible()
      await expect(page.getByTestId('chat-list')).toBeHidden()
      await page.getByTestId('chat-thread-header').getByRole('link', { name: 'رجوع' }).click()
      await expect(page).toHaveURL(/\/chat(\?|$)/)
      await expect(page.getByTestId('chat-list')).toBeVisible()
    })

    test('on a phone the draft survives opening and closing the info', async ({ page }) => {
      const sent = await mockChat(page)
      await open(page, '/chat/42')
      await composer(page).fill('مسودة على الهاتف @')
      await page.locator('form.nasq-chat-composer').getByRole('button', { name: 'سارة', exact: true }).click()
      await expect(composer(page)).toHaveValue('مسودة على الهاتف @سارة ')
      await infoButton(page).click()
      await expect(page.locator('[data-template="conversation-info"]')).toBeVisible()
      await expect(page.getByTestId('chat-thread')).toBeHidden()
      await expect(composer(page)).toBeHidden()
      expect(await fitsWidth(page)).toBe(true)
      await page.locator('[data-template="conversation-info"]').getByRole('link', { name: 'رجوع' }).click()
      await expect(page.getByTestId('chat-thread')).toBeVisible()
      await expect(composer(page)).toHaveValue('مسودة على الهاتف @سارة ')
      expect(sent).toEqual([])
      await page.getByRole('button', { name: 'إرسال', exact: true }).click()
      await expect.poll(() => sent).toEqual([{ conversationId: 42, payload: { body: 'مسودة على الهاتف @سارة ', mention_user_ids: [7] } }])
      await expect(composer(page)).toHaveValue('')
    })

    test('a direct phone info link and refresh have one heading, and leave asks inline', async ({ page }) => {
      await mockChat(page)
      await open(page, '/chat/42/info?filter=unread')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('معلومات المحادثة')
      await page.reload()
      await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('معلومات المحادثة')
      await page.getByTestId('chat-info').getByRole('button', { name: 'مغادرة المحادثة', exact: true }).click()
      await expect(page.getByTestId('inline-confirm')).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.getByTestId('inline-confirm-cancel').click()
      await expect(page.getByTestId('inline-confirm')).toHaveCount(0)
      await page.locator('[data-template="conversation-info"]').getByRole('link', { name: 'رجوع' }).click()
      await expect(page).toHaveURL(/\/chat\/42\?(?=.*filter=unread)/)
    })
  })
})
