import { test, expect, type Page } from '@playwright/test'

test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Isolated synthetic API only')

const conversation = { id: 42, type: 'direct', name: 'محادثة تجريبية', unread_count: 0, last_message_at: '2026-09-09T10:00:00Z', last_message_preview: 'رسالة ثانية', member_count: 2, muted: true, notifications: null, peer_seen_message_id: null, im_status: 'online', can_manage: true }
const messages = ['رسالة أولى', 'رسالة ثانية'].map((body, index) => ({ id: index + 1, conversation_id: 42, author: { id: 7, name: 'سارة' }, body, created_at: '2026-09-09T10:00:00Z', attachments: [], parent: null, edited: false, pinned: false, starred: false, reactions: [] }))

async function setup(page: Page) {
  const creates: unknown[] = []
  await page.route('**/api/v1/chat/**', async route => {
    const url = new URL(route.request().url())
    let body: unknown = { items: [], total: 0 }
    if (url.pathname.endsWith('/messages')) {
      const filtered = messages.filter(item => item.body.includes(url.searchParams.get('q') || ''))
      body = { items: filtered, total: filtered.length }
    } else if (url.pathname.endsWith('/conversations')) {
      if (route.request().method() === 'POST') { creates.push(route.request().postDataJSON()); body = { ...conversation, type: 'group' } }
      else body = { items: [conversation], total: 1 }
    } else if (/\/42(\/read)?$/.test(url.pathname)) body = conversation
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.route('**/api/v1/people**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 7, user_id: 7, name: 'سارة' }, { id: 8, user_id: 8, name: 'خالد' }]) }))
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
  return creates
}

test('closing message search restores the thread and muted conversations stay marked', async ({ page }) => {
  await setup(page)
  await page.goto('/chat/42')
  await expect(page.locator('[data-message-id]')).toHaveCount(2)
  await expect(page.getByTestId('chat-list')).toContainText('مكتوم')
  const searchButton = page.getByTestId('chat-thread-header').getByRole('button', { name: 'بحث في الرسائل' })
  await searchButton.click()
  const search = page.getByPlaceholder('بحث في الرسائل')
  await search.fill('أولى')
  await expect(page.locator('[data-message-id]')).toHaveCount(1)
  await searchButton.click()
  await expect(search).toHaveCount(0)
  await expect(page.locator('[data-message-id]')).toHaveCount(2)
  await expect(page.locator('html')).not.toHaveAttribute('data-project-theme')
})

// The recipient field is a multi-select menu: open it, choose the option, close the menu again.
async function pickRecipient(page: Page, name: RegExp) {
  await page.getByTestId('person-picker').click()
  await page.getByRole('option', { name }).click()
  await page.keyboard.press('Escape')
}

test('explicit group creation requires two recipients and preserves their ids', async ({ page }) => {
  const creates = await setup(page)
  await page.goto('/chat/new?kind=group')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'مجموعة جديدة', exact: true })).toBeVisible()
  const create = dialog.locator('button[type="submit"]')
  // DESIGN.md shows validation after an attempted submit, rather than disabling save.
  await expect(create).toBeEnabled()
  await create.click()
  await expect(dialog.getByRole('alert')).toContainText('اثنين على الأقل')
  await expect(dialog.locator('#chat-recipient-search')).toBeFocused()
  expect(creates).toEqual([])
  await pickRecipient(page, /سارة/)
  await create.click()
  await expect(dialog.getByRole('alert')).toContainText('اثنين على الأقل')
  expect(creates).toEqual([])
  await pickRecipient(page, /خالد/)
  await expect(create).toBeEnabled()
  await create.click()
  await expect(page).toHaveURL(/\/chat\/42/)
  expect(creates).toEqual([{ user_ids: [7, 8] }])
})

test.describe('touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('message actions remain visible without hover', async ({ page }) => {
    await setup(page)
    await page.goto('/chat/42')
    const actions = page.locator('.webvue-chat-msg-actions').first()
    await expect(actions).toBeVisible()
    await expect(actions).toHaveCSS('opacity', '1')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
})
