import { test, expect, type Page } from '@playwright/test'

// The customer-messages conversation frame at real viewport sizes. The audit found the phone kept the desktop
// two-column grid (a 260px list beside a 96px thread) because the shared layout kept VueUse's server width guess on
// the client. The panes are now hidden by CSS breakpoints, so these checks read the rendered panes at each width.

async function signIn(page: Page) {
  expect((await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })).status()).toBe(200)
}

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled({ timeout: 30_000 })
}

async function widthOf(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox()
  expect(box).not.toBeNull()
  return box!.width
}

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

test.describe('customer messages on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the conversation replaces the list, and Back restores the list at full width', async ({ page }) => {
    await signIn(page)
    await open(page, '/inbox')
    await expect(page.locator('[data-template="conversation-list"]')).toBeVisible()
    await expect(page.locator('[data-template="conversation-thread"]')).toBeHidden()
    await expectNoSidewaysScroll(page)

    await page.getByTestId('inbox-conversation-1').click()
    await expect(page).toHaveURL(/\/inbox\/1/)
    await expect(page.locator('[data-template="conversation-list"]')).toBeHidden()
    await expect(page.locator('[data-template="conversation-thread"]')).toBeVisible()
    await expect(page.getByTestId('inbox-thread-scroller')).toBeVisible()
    expect(await widthOf(page, '[data-template="conversation-thread"]')).toBeGreaterThan(300)
    await expectNoSidewaysScroll(page)

    await page.getByRole('link', { name: 'رجوع' }).first().click()
    await expect(page).toHaveURL(/\/inbox$/)
    await expect(page.locator('[data-template="conversation-list"]')).toBeVisible()
    await expect(page.locator('[data-template="conversation-thread"]')).toBeHidden()
    await expectNoSidewaysScroll(page)
  })

  test('a direct link and a refresh keep the thread full width', async ({ page }) => {
    await signIn(page)
    await open(page, '/inbox/1')
    expect(await widthOf(page, '[data-template="conversation-thread"]')).toBeGreaterThan(300)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('inbox-thread-scroller')).toBeVisible()
    expect(await widthOf(page, '[data-template="conversation-thread"]')).toBeGreaterThan(300)
    await expectNoSidewaysScroll(page)
  })

  test('the contact panel replaces the thread, and returning restores it', async ({ page }) => {
    await signIn(page)
    await open(page, '/inbox/1/info')
    await expect(page.locator('[data-template="conversation-info"]')).toBeVisible()
    await expect(page.getByTestId('inbox-contact-panel')).toBeVisible()
    await expect(page.locator('[data-template="conversation-thread"]')).toBeHidden()
    await expect(page.getByTestId('inbox-info-toggle')).toHaveAttribute('aria-expanded', 'true')
    await expectNoSidewaysScroll(page)

    await page.getByRole('link', { name: 'رجوع' }).first().click()
    await expect(page).toHaveURL(/\/inbox\/1(\?|$)/)
    await expect(page.locator('[data-template="conversation-thread"]')).toBeVisible()
    await expect(page.locator('[data-template="conversation-info"]')).toHaveCount(0)
  })

  test('the orders panel replaces the thread on the phone', async ({ page }) => {
    await signIn(page)
    await open(page, '/inbox/1/orders')
    await expect(page.locator('[data-template="conversation-info"]')).toBeVisible()
    await expect(page.getByTestId('inbox-order-panel')).toBeVisible()
    await expectNoSidewaysScroll(page)
  })
})

test.describe('customer messages on a tablet and a desktop', () => {
  for (const width of [768, 1440]) {
    test(`the list and the thread share the frame at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await signIn(page)
      await open(page, '/inbox/1')
      await expect(page.locator('[data-template="conversation-list"]')).toBeVisible()
      await expect(page.locator('[data-template="conversation-thread"]')).toBeVisible()
      expect(await widthOf(page, '[data-template="conversation-list"]')).toBeGreaterThanOrEqual(250)
      expect(await widthOf(page, '[data-template="conversation-thread"]')).toBeGreaterThan(300)
      await expectNoSidewaysScroll(page)
    })
  }

  test('the contact panel is a third column only from 1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page)
    await open(page, '/inbox/1/info')
    await expect(page.locator('[data-template="conversation-info"]')).toBeVisible()
    await expect(page.locator('[data-template="conversation-thread"]')).toBeVisible()

    await page.setViewportSize({ width: 1024, height: 900 })
    await expect(page.locator('[data-template="conversation-info"]')).toBeVisible()
    await expect(page.locator('[data-template="conversation-thread"]')).toBeHidden()
  })
})

test.describe('internal chat shares the frame', () => {
  test('at 390px the conversation replaces the list and fills the width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const conversation = { id: 42, type: 'direct', name: 'محادثة تجريبية', unread_count: 0, last_message_at: '2026-09-09T10:00:00Z', last_message_preview: 'رسالة أولى', member_count: 2, muted: false, notifications: null, peer_seen_message_id: null, im_status: 'online', can_manage: true, can_remove_members: false }
    const messages = [{ id: 1, conversation_id: 42, author: { id: 7, name: 'سارة' }, body: 'رسالة أولى', created_at: '2026-09-09T10:00:00Z', attachments: [], parent: null, edited: false, deleted: false, pinned: false, starred: false, reactions: [], notice: null }]
    await page.route('**/api/v1/chat/**', async route => {
      const url = new URL(route.request().url())
      const body = url.pathname.endsWith('/messages') ? { items: messages, total: 1 } : url.pathname.endsWith('/conversations') ? { items: [conversation], total: 1 } : conversation
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
    await signIn(page)
    await open(page, '/chat/42')
    await expect(page.getByTestId('chat-thread')).toBeVisible()
    await expect(page.getByTestId('chat-thread')).toContainText('رسالة أولى')
    await expect(page.getByTestId('chat-list')).toBeHidden()
    expect(await widthOf(page, '[data-template="conversation-thread"]')).toBeGreaterThan(300)
    await expectNoSidewaysScroll(page)
  })
})
