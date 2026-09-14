import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const TEST_PASSWORD = 'NasqAccess-Test-123!'

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

async function loginAs(page: Page, username: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill(username)
  await page.getByLabel('كلمة المرور').fill(password)
  await page.getByRole('button', { name: 'دخول' }).click()
  // Login lands on the first section the user may open (accessPolicy.firstAllowedPath).
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
}

async function json(request: APIRequestContext, method: 'get' | 'post', url: string, data?: unknown) {
  const response = await request[method](url, data === undefined ? {} : { data })
  expect(response.ok(), `${method} ${url}: ${response.status()} ${await response.text()}`).toBeTruthy()
  return response.json()
}

// The collaboration E2E seed only provisions admin. Create the second internal
// recipient through the capability-based account grant API.
async function ensureRecipientUser(page: Page, login: string, password: string): Promise<number> {
  const me = await json(page.request, 'get', '/api/v1/me')
  const roles = await json(page.request, 'get', '/api/v1/admin/roles')
  const role = roles.items.find((item: { key: string }) => item.key === 'employee')
  expect(role).toBeTruthy()
  const employee = await json(page.request, 'post', '/api/v1/hr/employees', {
    name: 'E2E Notification Recipient', work_email: login,
  })
  const user = await json(page.request, 'post', '/api/v1/admin/users', {
    employee_id: employee.id,
    password,
    assignments: [{ role_id: role.id, scope: { kind: 'company', id: me.company.id } }],
  })
  return user.id
}

test('notification endpoint returns the polling envelope after login', async ({ page }) => {
  await loginAs(page, 'admin', 'admin')
  const response = await page.request.get('/api/v1/notifications?limit=10&offset=0')
  expect(response.status()).toBe(200)
  const body = await response.json()
  expect(body.items).toEqual(expect.any(Array))
  expect(body.total).toEqual(expect.any(Number))
  expect(body.unread_count).toEqual(expect.any(Number))
})

test('second user receives real assignment and comment events and read state survives reload', async ({ page, browser }) => {
  await loginAs(page, 'admin', 'admin')
  const runId = Date.now().toString()
  const recipientLogin = `e2e_notifications_recipient_${runId}@example.test`
  const recipientPassword = TEST_PASSWORD
  const recipientId = await ensureRecipientUser(page, recipientLogin, recipientPassword)

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

  const recipientPage = await browser.newPage({
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    locale: 'ar-SA',
  })
  await loginAs(recipientPage, recipientLogin, recipientPassword)
  const recipientNotifications = await recipientPage.request.get('/api/v1/notifications')
  expect(recipientNotifications.status()).toBe(200)
  const recipientBody = await recipientNotifications.json()
  const events = recipientBody.items.filter((item: NotificationItem) => item.task_id === task.id)
  expect(events.map((item: NotificationItem) => item.kind).sort()).toEqual(['assignment', 'comment'])
  expect(events.every((item: NotificationItem) => item.is_read === false)).toBe(true)
  const assignment = events.find((item: NotificationItem) => item.kind === 'assignment') as NotificationItem
  const comment = events.find((item: NotificationItem) => item.kind === 'comment') as NotificationItem

  await recipientPage.getByTestId('notification-bell').click()
  await recipientPage.getByTestId('notification-preview').getByRole('link', { name: 'المزيد', exact: true }).click()
  await expect(recipientPage).toHaveURL(/\/notifications$/)
  await expect(recipientPage.getByTestId('notification-center')).toBeVisible()
  await expect(recipientPage.getByTestId('notification-count')).toHaveText('2')
  await expect(recipientPage.getByTestId(`notification-${assignment.id}`)).toContainText(task.name)
  await expect(recipientPage.getByTestId(`notification-${comment.id}`)).toContainText('A real actor comment')

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
  expect(afterAssignmentBody.unread_count).toBe(1)

  // A full page reload must retain the one unread comment for this recipient.
  await recipientPage.goto('/notifications')
  await recipientPage.reload()
  await expect(recipientPage.getByTestId('notification-count')).toHaveText('1')
  const assignmentClass = await recipientPage.getByTestId(`notification-${assignment.id}`).getAttribute('class')
  expect(assignmentClass ?? '').not.toContain('bg-brand-soft')
  const unreadComment = recipientPage.getByTestId(`notification-${comment.id}`)
  await expect(unreadComment).toHaveClass(/bg-brand-soft/)
  await expect(unreadComment.getByText('غير مقروءة', { exact: true })).toBeVisible()

  const secondRead = recipientPage.waitForResponse((response) => (
    response.url().endsWith(`/api/v1/notifications/${comment.id}/read`)
      && response.request().method() === 'POST'
  ))
  await recipientPage.getByTestId(`notification-${comment.id}`).click()
  expect((await secondRead).status()).toBe(200)
  await expect(recipientPage).toHaveURL(new RegExp(`/tasks/${task.id}$`))

  await recipientPage.goto('/notifications')
  await recipientPage.reload()
  await expect(recipientPage.getByTestId('notification-count')).toHaveCount(0)
  await recipientPage.context().close()
})
