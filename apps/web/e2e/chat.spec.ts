import { mkdirSync } from 'node:fs'
import { expect, test, type Browser, type Page } from '@playwright/test'
import {
  ChatConversationSchema,
  ChatMessageListSchema,
  ChatRecipientListSchema,
} from '@webvue/contracts'

const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
const FIXTURE_PASSWORD = 'WebVueAccess-Test-123!'
const SHOTS = process.env.CHAT_E2E_SHOT_DIR
  ?? '/var/folders/17/rgg6yjtn60d3jf_3xszmvtw00000gn/T/opencode/webvue-chat-workspace-logs/screenshots'

async function loginAs(page: Page, username: string, password: string) {
  const login = await page.request.post('/api/auth/login', { data: { login: username, password } })
  expect(login.status()).toBe(200)
}

async function provisionPeer(page: Page) {
  const me = await (await page.request.get('/api/v1/me')).json()
  const roles = await (await page.request.get('/api/v1/admin/roles')).json()
  const employeeRole = roles.items.find((role: { key: string }) => role.key === 'employee')
  const suffix = `${Date.now()}`
  const login = `chat-peer-${suffix}@example.test`
  const employee = await (await page.request.post('/api/v1/hr/employees', {
    data: { name: `Chat peer ${suffix}`, work_email: login },
  })).json()
  const user = await (await page.request.post('/api/v1/admin/employee-accounts', {
    data: {
      employee_id: employee.id,
      password: FIXTURE_PASSWORD,
      assignments: [{ role_id: employeeRole.id, scope: { kind: 'company', id: me.company.id } }],
    },
  })).json()
  return { user, login, suffix }
}

test('chat workspace lists server conversations and opens a thread', async ({ page }) => {
  await loginAs(page, ADMIN_LOGIN, ADMIN_PASSWORD)
  const { user } = await provisionPeer(page)
  const created = ChatConversationSchema.parse(await (await page.request.post('/api/v1/chat/conversations', {
    data: { user_ids: [user.id] },
  })).json())
  const sent = await page.request.post(`/api/v1/chat/conversations/${created.id}/messages`, {
    data: { body: 'visible on the page' },
  })
  expect(sent.status()).toBe(201)
  await page.goto(`/chat/${created.id}`)
  await expect(page.getByTestId('chat-thread')).toBeVisible()
  await expect(page.getByTestId('chat-thread').getByText('visible on the page')).toBeVisible({ timeout: 15_000 })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/chat')
  await expect(page.getByTestId('chat-list')).toBeVisible()
  ChatRecipientListSchema.parse(await (await page.request.get('/api/v1/chat/recipients')).json())
  ChatMessageListSchema.parse(await (await page.request.get(`/api/v1/chat/conversations/${created.id}/messages`)).json())
})

test('opening a focused short unread thread records its initial read receipt without scrolling', async ({ page, browser }) => {
  await loginAs(page, ADMIN_LOGIN, ADMIN_PASSWORD)
  const { user, login } = await provisionPeer(page)
  const created = ChatConversationSchema.parse(await (await page.request.post('/api/v1/chat/conversations', {
    data: { user_ids: [user.id] },
  })).json())
  const peerContext = await browser.newContext()
  const peerPage = await peerContext.newPage()
  await loginAs(peerPage, login, FIXTURE_PASSWORD)
  const marker = `initial-read-${Date.now()}`
  const peerSent = await peerPage.request.post(`/api/v1/chat/conversations/${created.id}/messages`, {
    data: { body: marker },
  })
  expect(peerSent.status()).toBe(201)
  const peerMessage = await peerSent.json() as { id: number }
  const unreadBeforeOpen = await page.request.get(`/api/v1/chat/conversations/${created.id}`)
  expect((await unreadBeforeOpen.json()).unread_count).toBeGreaterThan(0)

  await page.bringToFront()
  const readRequestPromise = page.waitForRequest(request => (
    request.method() === 'POST'
    && request.url().endsWith(`/api/v1/chat/conversations/${created.id}/read`)
  ), { timeout: 15_000 })
  const readResponsePromise = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && response.url().endsWith(`/api/v1/chat/conversations/${created.id}/read`)
    && response.status() === 200
  ), { timeout: 15_000 })
  await page.goto(`/chat/${created.id}`)
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true)
  const [readRequest, readResponse] = await Promise.all([readRequestPromise, readResponsePromise])
  expect(readRequest.postDataJSON()).toEqual({ message_id: peerMessage.id })
  expect((await readResponse.json()).unread_count).toBe(0)
  await expect(page.getByTestId('chat-thread').getByText(marker, { exact: true })).toBeVisible()
  expect(await page.getByTestId('chat-scroller').evaluate(element => element.scrollTop)).toBe(0)

  const followUpMarker = `poll-read-${Date.now()}`
  const followUpReadRequestPromise = page.waitForRequest(request => (
    request.method() === 'POST'
    && request.url().endsWith(`/api/v1/chat/conversations/${created.id}/read`)
  ), { timeout: 15_000 })
  const followUpReadResponsePromise = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && response.url().endsWith(`/api/v1/chat/conversations/${created.id}/read`)
    && response.status() === 200
  ), { timeout: 15_000 })
  const followUpSent = await peerPage.request.post(`/api/v1/chat/conversations/${created.id}/messages`, {
    data: { body: followUpMarker },
  })
  expect(followUpSent.status()).toBe(201)
  const followUpMessage = await followUpSent.json() as { id: number }
  const [followUpReadRequest, followUpReadResponse] = await Promise.all([followUpReadRequestPromise, followUpReadResponsePromise])
  expect(followUpReadRequest.postDataJSON()).toEqual({ message_id: followUpMessage.id })
  expect((await followUpReadResponse.json()).unread_count).toBe(0)
  await expect(page.getByTestId('chat-thread').getByText(followUpMarker, { exact: true })).toBeVisible()
  expect(await page.getByTestId('chat-scroller').evaluate(element => element.scrollTop)).toBe(0)
  await peerContext.close()
})

test('second browser receives a live message within 10s and captures mobile RTL/LTR shots', async ({ page, browser }: { page: Page; browser: Browser }) => {
  mkdirSync(SHOTS, { recursive: true })
  await loginAs(page, ADMIN_LOGIN, ADMIN_PASSWORD)
  const { user, login } = await provisionPeer(page)
  const created = ChatConversationSchema.parse(await (await page.request.post('/api/v1/chat/conversations', {
    data: { user_ids: [user.id] },
  })).json())
  const peerContext = await browser.newContext()
  const peerPage = await peerContext.newPage()
  await loginAs(peerPage, login, FIXTURE_PASSWORD)
  await page.goto(`/chat/${created.id}`)
  await peerPage.goto(`/chat/${created.id}`)
  await expect(page.getByTestId('chat-thread')).toBeVisible()
  await expect(peerPage.getByTestId('chat-thread')).toBeVisible()
  const marker = `peer-live-${Date.now()}`
  await page.getByPlaceholder(/اكتب رسالة|Write a message/).fill(marker)
  await page.getByRole('button', { name: /إرسال|Send/ }).click()
  await expect(peerPage.getByTestId('chat-thread').getByText(marker)).toBeVisible({ timeout: 10_000 })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: `${SHOTS}/chat-1440-ar.png`, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${SHOTS}/chat-390-ar.png`, fullPage: true })
  await peerPage.evaluate(async () => {
    const nuxt = (window as unknown as { $nuxt?: { $i18n?: { setLocale: (code: string) => Promise<void> } } }).$nuxt
    if (nuxt?.$i18n) await nuxt.$i18n.setLocale('en')
  })
  await peerPage.setViewportSize({ width: 390, height: 844 })
  await peerPage.screenshot({ path: `${SHOTS}/chat-390-en.png`, fullPage: true })
  await peerContext.close()
})
