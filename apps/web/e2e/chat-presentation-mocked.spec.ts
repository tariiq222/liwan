import { test, expect, type Page } from '@playwright/test'

test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Isolated synthetic API only')
test.setTimeout(90_000)

const conversation = { id: 42, type: 'direct', name: 'محادثة تجريبية', unread_count: 0, last_message_at: '2026-09-09T10:00:00Z', last_message_preview: 'رسالة ثانية', member_count: 2, muted: true, notifications: null, peer_seen_message_id: null, im_status: 'online', can_manage: true, can_remove_members: false }
const messages = ['رسالة أولى', 'رسالة ثانية'].map((body, index) => ({ id: index + 1, conversation_id: 42, author: { id: 7, name: 'سارة' }, body, created_at: '2026-09-09T10:00:00Z', attachments: [], parent: null, edited: false, deleted: false, pinned: false, starred: false, reactions: [], notice: null }))

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
  expect((await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })).status()).toBe(200)
  return creates
}

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled({ timeout: 30_000 })
}

test('one create menu distinguishes conversations, groups and channels and keeps list filters', async ({ page }) => {
  await setup(page)
  await open(page, '/chat?filter=unread&q=ali')
  const toolbar = page.getByTestId('chat-list').locator('header')
  await expect(toolbar.getByRole('button', { name: 'جديد', exact: true })).toBeVisible()
  await expect(toolbar.locator('a')).toHaveCount(0)
  await toolbar.getByRole('button', { name: 'جديد', exact: true }).click()
  for (const [label, kind] of [['محادثة', 'direct'], ['مجموعة', 'group'], ['قناة', 'channel']]) {
    await expect(page.getByRole('menuitem', { name: label, exact: true })).toHaveAttribute('href', new RegExp(`kind=${kind}`))
  }
  await page.getByRole('menuitem', { name: 'مجموعة', exact: true }).click()
  await expect(page).toHaveURL(/filter=unread/)
  await expect(page).toHaveURL(/q=ali/)
  await expect(page.getByRole('heading', { name: 'مجموعة جديدة', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('chat-list')).toBeVisible()
})

test('closing message search restores the thread and muted conversations stay marked', async ({ page }) => {
  await setup(page)
  await open(page, '/chat/42')
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
async function pickRecipient(page: Page, name: RegExp, multiple = true) {
  await page.getByTestId('person-picker').click()
  // Search after hydration so the client fixture is used even when SSR supplied the initial directory.
  await page.getByRole('combobox', { name: 'بحث', exact: true }).fill(name.source)
  await page.getByRole('option', { name }).click()
  if (multiple) await page.keyboard.press('Escape')
}

test('explicit group creation requires two recipients and preserves their ids', async ({ page }) => {
  const creates = await setup(page)
  await open(page, '/chat/new?kind=group')
  const form = page.getByTestId('chat-create-form')
  await expect(form).toBeVisible()
  await expect(page.getByRole('heading', { name: 'مجموعة جديدة', exact: true })).toBeVisible()
  const create = page.locator('button[form="chat-create-form"][type="submit"]')
  // DESIGN.md shows validation after an attempted submit, rather than disabling save.
  await expect(create).toBeEnabled()
  await create.click()
  await expect(form.getByRole('alert')).toContainText('شخصين على الأقل')
  await expect(form.locator('#chat-recipient-search')).toBeFocused()
  expect(creates).toEqual([])
  await pickRecipient(page, /سارة/)
  await create.click()
  await expect(form.getByRole('alert')).toContainText('شخصين على الأقل')
  expect(creates).toEqual([])
  await pickRecipient(page, /خالد/)
  await expect(create).toBeEnabled()
  await create.click()
  await expect(page).toHaveURL(/\/chat\/42/)
  expect(creates).toEqual([{ type: 'group', user_ids: [7, 8] }])
})

test('direct conversation selects one person and never exposes a group name', async ({ page }) => {
  const creates = await setup(page)
  await open(page, '/chat/new?kind=direct')
  const form = page.getByTestId('chat-create-form')
  await expect(page.getByRole('heading', { name: 'محادثة جديدة', exact: true })).toBeVisible()
  await expect(form.locator('#chat-group-name')).toHaveCount(0)
  await page.locator('button[form="chat-create-form"][type="submit"]').click()
  await expect(form.getByRole('alert')).toContainText('اختر شخصًا واحدًا')
  expect(creates).toEqual([])
  await pickRecipient(page, /سارة/, false)
  await expect(form).toBeVisible()
  await page.locator('button[form="chat-create-form"][type="submit"]').click()
  await expect(page).toHaveURL(/\/chat\/42/)
  expect(creates).toEqual([{ type: 'direct', user_ids: [7] }])
})

test('channel creation asks for its own name and sends an explicit channel payload', async ({ page }) => {
  const creates = await setup(page)
  await open(page, '/chat/new?kind=channel')
  const form = page.getByTestId('chat-create-form')
  await expect(page.getByRole('heading', { name: 'قناة جديدة', exact: true })).toBeVisible()
  await expect(form.getByTestId('person-picker')).toHaveCount(0)
  await page.locator('button[form="chat-create-form"][type="submit"]').click()
  await expect(form.getByRole('alert')).toContainText('أدخل اسم القناة')
  await expect(form.locator('#chat-group-name')).toBeFocused()
  expect(creates).toEqual([])
  await form.locator('#chat-group-name').fill('  إعلانات الفريق  ')
  await page.locator('button[form="chat-create-form"][type="submit"]').click()
  await expect(page).toHaveURL(/\/chat\/42/)
  expect(creates).toEqual([{ type: 'channel', name: 'إعلانات الفريق' }])
})

test('cancelling group creation protects its draft and returns to the filtered list', async ({ page }) => {
  const creates = await setup(page)
  await open(page, '/chat?filter=unread&q=ali')
  await page.getByRole('button', { name: 'جديد', exact: true }).click()
  await page.getByRole('menuitem', { name: 'مجموعة', exact: true }).click()
  await page.locator('#chat-group-name').fill('مسودة الفريق')
  await page.getByRole('link', { name: 'إلغاء', exact: true }).click()
  const guard = page.getByTestId('unsaved-changes-dialog')
  await expect(guard).toBeVisible()
  await guard.getByRole('button', { name: 'البقاء في الصفحة', exact: true }).click()
  await expect(page.locator('#chat-group-name')).toHaveValue('مسودة الفريق')
  await page.getByRole('link', { name: 'إلغاء', exact: true }).click()
  await guard.getByRole('button', { name: 'المغادرة بدون حفظ', exact: true }).click()
  await expect(page).toHaveURL(/\/chat\?q=ali&filter=unread$/)
  expect(creates).toEqual([])
})

test('switching creation kind protects the draft and discarding clears fields from the previous kind', async ({ page }) => {
  const creates = await setup(page)
  await open(page, '/chat/new?kind=group')
  await page.locator('#chat-group-name').fill('مسودة المجموعة')
  await page.getByTestId('chat-list').getByRole('button', { name: 'غير مقروء', exact: true }).click()
  await expect(page).toHaveURL(/filter=unread/)
  await expect(page).toHaveURL(/kind=group/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('#chat-group-name')).toHaveValue('مسودة المجموعة')
  const switchToChannel = async () => {
    await page.getByRole('button', { name: 'جديد', exact: true }).click()
    await page.getByRole('menuitem', { name: 'قناة', exact: true }).click()
  }
  await switchToChannel()
  const guard = page.getByTestId('unsaved-changes-dialog')
  await expect(guard).toBeVisible()
  await guard.getByRole('button', { name: 'البقاء في الصفحة', exact: true }).click()
  await expect(page).toHaveURL(/kind=group/)
  await expect(page.locator('#chat-group-name')).toHaveValue('مسودة المجموعة')
  await switchToChannel()
  await guard.getByRole('button', { name: 'المغادرة بدون حفظ', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'قناة جديدة', exact: true })).toBeVisible()
  await expect(page.locator('#chat-group-name')).toHaveValue('')
  await expect(page.getByTestId('person-picker')).toHaveCount(0)
  expect(creates).toEqual([])
})

test('an English channel form stays inline and a failed create keeps its draft for retry', async ({ page, baseURL }) => {
  const creates = await setup(page)
  await page.context().addCookies([{ name: 'liwan-locale', value: 'en', url: baseURL! }])
  let failed = true
  await page.route('**/api/v1/chat/conversations', async route => {
    if (route.request().method() === 'POST' && failed) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'server_error', message: 'Synthetic failure' }) })
    } else await route.fallback()
  })
  await open(page, '/chat/new?kind=channel')
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page.getByRole('heading', { name: 'New channel', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('chat-list')).toBeVisible()
  await page.locator('#chat-group-name').fill('Team updates')
  await page.getByRole('button', { name: 'Create channel', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.locator('#chat-group-name')).toHaveValue('Team updates')
  expect(creates).toEqual([])
  failed = false
  await page.getByRole('button', { name: 'Create channel', exact: true }).click()
  await expect(page).toHaveURL(/\/chat\/42/)
  expect(creates).toEqual([{ type: 'channel', name: 'Team updates' }])
})

test.describe('touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('creation uses the mobile conversation area and Back returns to its filtered list', async ({ page }) => {
    await setup(page)
    await open(page, '/chat/new?kind=channel&filter=channels')
    await expect(page.getByTestId('chat-create-form')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    const submitBox = await page.locator('button[form="chat-create-form"][type="submit"]').boundingBox()
    expect(submitBox!.y + submitBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height - 12)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    // The shell is 2-3px taller than the viewport right after the form mounts and settles on its own; assert the settled layout.
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true)
    await page.getByRole('link', { name: 'رجوع', exact: true }).click()
    await expect(page).toHaveURL(/\/chat\?filter=channels$/)
    await expect(page.getByTestId('chat-create-form')).toHaveCount(0)
    await expect(page.getByTestId('chat-list')).toBeVisible()
  })
  test('message actions remain visible without hover', async ({ page }) => {
    await setup(page)
    await open(page, '/chat/42')
    const actions = page.locator('.liwan-chat-msg-actions').first()
    await expect(actions).toBeVisible()
    await expect(actions).toHaveCSS('opacity', '1')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
})
