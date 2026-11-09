import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { ACCEPTANCE_ORIGIN, openShell, signIn, signedInPage } from './support/realOdooSession'

// Runs only on the isolated real-Odoo stack (deploy/ci/e2e-odoo.sh).
test.skip(process.env.E2E_REAL_ODOO !== '1', 'Explicit isolated real Odoo acceptance only')

test.beforeEach(async ({}, info) => { expect(new URL(String(info.project.use.baseURL)).origin).toBe(ACCEPTANCE_ORIGIN) })

type NotificationItem = {
  id: number
  kind: 'assignment' | 'comment' | 'deadline' | 'overdue_digest'
  task_id?: number
  task_name?: string
  digest_id?: number
  overdue_count?: number
  local_date?: string | null
  body: string
  created_at: string
  is_read: boolean
}

async function json(request: APIRequestContext, method: 'get' | 'post', url: string, data?: unknown) {
  const response = await request[method](url, data === undefined ? {} : { data })
  expect(response.ok(), `${method} ${url}: ${response.status()} ${await response.text()}`).toBeTruthy()
  return response.json()
}

// Two elements carry the `notification-count` test id: the header bell badge (the unread number) and the page
// footer, which renders `notifications.shown` — a pluralized Arabic sentence ("إشعاران", "4 إشعارات"), not a bare
// number. Every assertion names the container it means, so neither can resolve to the other.
const bellBadge = (page: Page) => page.getByTestId('notification-bell').getByTestId('notification-count')
const footerCount = (page: Page) => page.getByTestId('notification-center').getByTestId('notification-count')
/** The badge prints the unread count, capped at 9+ (`NotificationCenter.vue`); at zero it is not rendered. */
function badgeText(unread: number): string {
  return unread > 9 ? '9+' : String(unread)
}

/** The bell badge equals the API's unread count, and is absent when nothing is unread. */
async function expectBadge(page: Page, unread: number) {
  if (unread === 0) {
    await expect(bellBadge(page)).toHaveCount(0)
    return
  }
  await expect(bellBadge(page)).toHaveText(badgeText(unread))
}

// The page loads `NOTIFICATION_PAGE_SIZE` rows per request (`useNotifications`), and the footer states how many it
// shows, so `min(total, 50)` from the same endpoint answer is the sentence the footer must carry.
const NOTIFICATION_PAGE_SIZE = 50

/**
 * `notifications.shown`, the footer sentence: "إشعار واحد", "إشعاران", "4 إشعارات" — the same plural rule as
 * i18n/locales/ar/notifications.json. A sentence, never the bare number the bell badge prints.
 */
function arabicShown(count: number): string {
  if (count === 0) return 'لا إشعارات'
  if (count === 1) return 'إشعار واحد'
  if (count === 2) return 'إشعاران'
  const rest = count % 100
  if (rest >= 3 && rest <= 10) return `${count} إشعارات`
  if (rest >= 11 && rest <= 99) return `${count} إشعارًا`
  return `${count} إشعار`
}

/** Unread rows carry the dot and the word; a read row carries neither, and keeps its place in the all filter. */
async function expectUnreadRow(page: Page, id: number, unread: boolean) {
  const row = page.getByTestId(`notification-${id}`)
  await expect(row, 'a read row stays in the all filter').toBeVisible()
  await expect(row.getByTestId('notification-unread-dot')).toHaveCount(unread ? 1 : 0)
  await expect(row.getByText('غير مقروءة', { exact: true })).toHaveCount(unread ? 1 : 0)
}

test('notification endpoint returns the polling envelope after sign-in', async ({ page }) => {
  await signIn(page, 'admin')
  const response = await page.request.get('/api/v1/notifications?limit=10&offset=0')
  expect(response.status()).toBe(200)
  const body = await response.json()
  expect(body.items).toEqual(expect.any(Array))
  expect(body.total).toEqual(expect.any(Number))
  expect(body.unread_count).toEqual(expect.any(Number))
})

test('second user receives real assignment and comment events and read state survives reload', async ({ page, browser }) => {
  await signIn(page, 'admin')
  // The recipient's id lives in its own signed-in session: the password step leaves only a pre-session, so
  // /api/v1/me answers after the device step. That same page then drives the recipient's assertions.
  const recipient = await signedInPage(browser, 'staff1')
  try {
    const recipientId = (await json(recipient.page.request, 'get', '/api/v1/me')).id

    const projectResponse = await page.request.post('/api/v1/projects', {
      data: { name: `E2E notifications ${Date.now()}`, date_end: '2035-12-31' },
    })
    expect(projectResponse.status()).toBe(201)
    const project = await projectResponse.json()

    const taskResponse = await page.request.post('/api/v1/tasks', {
      data: { name: `E2E recipient event ${Date.now()}`, project_id: project.id },
    })
    expect(taskResponse.status()).toBe(201)
    const task = await taskResponse.json()

    const assignResponse = await page.request.patch(`/api/v1/tasks/${task.id}`, {
      data: { user_ids: [recipientId] },
    })
    expect(assignResponse.status()).toBe(200)

    const commentResponse = await page.request.post(`/api/v1/tasks/${task.id}/comments`, {
      data: { body: 'A real actor comment for the notification recipient' },
    })
    expect(commentResponse.status()).toBe(201)

    // The actor session must not receive the recipient's assignment/comment rows.
    const actorNotifications = await page.request.get('/api/v1/notifications')
    expect(actorNotifications.status()).toBe(200)
    const actorBody = await actorNotifications.json()
    expect(actorBody.items.filter((item: NotificationItem) => item.task_id === task.id)).toEqual([])

    const recipientPage = recipient.page
    await openShell(recipientPage, '/')
    const recipientNotifications = await recipientPage.request.get('/api/v1/notifications')
    expect(recipientNotifications.status()).toBe(200)
    const recipientBody = await recipientNotifications.json()
    const events = recipientBody.items.filter((item: NotificationItem) => item.task_id === task.id)
    expect(events.map((item: NotificationItem) => item.kind).sort()).toEqual(['assignment', 'comment'])
    expect(events.every((item: NotificationItem) => item.is_read === false)).toBe(true)
    const assignment = events.find((item: NotificationItem) => item.kind === 'assignment') as NotificationItem
    const comment = events.find((item: NotificationItem) => item.kind === 'comment') as NotificationItem

    const unreadBeforeRead = recipientBody.unread_count as number
    const shownBeforeRead = Math.min(recipientBody.total as number, NOTIFICATION_PAGE_SIZE)

    await recipientPage.getByTestId('notification-bell').click()
    await recipientPage.getByTestId('notification-preview').getByRole('link', { name: 'المزيد', exact: true }).click()
    await expect(recipientPage).toHaveURL(/\/notifications$/)
    await expect(recipientPage.getByTestId('notification-center')).toBeVisible()
    // The bell badge is the unread number; the footer is the shown sentence. Each is asserted on its own container,
    // so no locator resolves to two elements.
    await expectBadge(recipientPage, unreadBeforeRead)
    await expect(footerCount(recipientPage)).toHaveText(arabicShown(shownBeforeRead))
    await expect(recipientPage.getByTestId(`notification-${assignment.id}`)).toContainText(task.name)
    await expect(recipientPage.getByTestId(`notification-${comment.id}`)).toContainText('A real actor comment')
    await expectUnreadRow(recipientPage, assignment.id, true)
    await expectUnreadRow(recipientPage, comment.id, true)

    const firstRead = recipientPage.waitForResponse((response) => (
      response.url().endsWith(`/api/v1/notifications/${assignment.id}/read`)
        && response.request().method() === 'POST'
    ))
    await recipientPage.getByTestId(`notification-${assignment.id}`).click()
    expect((await firstRead).status()).toBe(200)
    await expect(recipientPage).toHaveURL(new RegExp(`/tasks/${task.id}$`))

    const afterAssignment = await recipientPage.request.get('/api/v1/notifications')
    const afterAssignmentBody = await afterAssignment.json()
    const persistedAssignment = afterAssignmentBody.items.find((item: NotificationItem) => item.id === assignment.id)
    expect(persistedAssignment?.is_read).toBe(true)
    expect(afterAssignmentBody.unread_count).toBe(unreadBeforeRead - 1)

    // A full page reload must retain the one unread comment and the read mark on the assignment row. A read row
    // keeps its place in the all filter; only the unread dot and word go away.
    await recipientPage.goto('/notifications')
    await recipientPage.reload()
    await expectBadge(recipientPage, unreadBeforeRead - 1)
    await expectUnreadRow(recipientPage, assignment.id, false)
    await expectUnreadRow(recipientPage, comment.id, true)

    const secondRead = recipientPage.waitForResponse((response) => (
      response.url().endsWith(`/api/v1/notifications/${comment.id}/read`)
        && response.request().method() === 'POST'
    ))
    await recipientPage.getByTestId(`notification-${comment.id}`).click()
    expect((await secondRead).status()).toBe(200)
    await expect(recipientPage).toHaveURL(new RegExp(`/tasks/${task.id}$`))

    // This journey's own two events are read; the account may still carry other unread rows from earlier runs, so the
    // end state is the count it started with minus the two it just read — never a global zero. The rows stay in the
    // all filter (they are not removed, so a `toHaveCount(0)` on the rows would describe the wrong end state): they
    // lose the dot and the word, and the bell badge agrees with the same computed count.
    const unreadAfterRead = unreadBeforeRead - 2
    await recipientPage.goto('/notifications')
    await recipientPage.reload()
    const finalBody = await (await recipientPage.request.get('/api/v1/notifications')).json()
    expect(finalBody.unread_count, 'reading both events marks exactly those two read').toBe(unreadAfterRead)
    await expectUnreadRow(recipientPage, assignment.id, false)
    await expectUnreadRow(recipientPage, comment.id, false)
    await expectBadge(recipientPage, unreadAfterRead)
  } finally { await recipient.context.close() }
})
