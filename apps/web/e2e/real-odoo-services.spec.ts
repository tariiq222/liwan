import { test, expect, type Page, type APIResponse, type Response } from '@playwright/test'
import { readFileSync } from 'node:fs'

// This suite creates scratch records. The coordinator alone selects/seeds/runs its real database.
test.skip(process.env.E2E_REAL_ODOO !== '1', 'Explicit isolated real Odoo acceptance only')
test.beforeEach(async ({}, info) => { const origin = new URL(String(info.project.use.baseURL)); expect(origin.hostname).toBe('localhost'); expect(origin.port).toBe('44300') })
type Fixtures = { company: number; admin: number; reader: number; department: number; grant_employee: number; grant_email: string; device: { admin: string; reader: string } }
function fixtures(): Fixtures {
  const path = process.env.E2E_REAL_FIXTURE
  if (!path) throw new Error('E2E_REAL_FIXTURE must name the coordinator exported scratch fixture JSON')
  return JSON.parse(readFileSync(path, 'utf8')) as Fixtures
}
async function body(response: APIResponse | Response, status = 200) {
  expect(response.status(), await response.text()).toBe(status)
  return response.json()
}
// Every sign-in is two-step. The fixture seeds one remembered device per acceptance account, because a
// scratch stack has no SMS provider and only a code's hash is stored; this drives that second path.
async function login(page: Page, reader = false) {
  const token = fixtures().device?.[reader ? 'reader' : 'admin']
  expect(token, 'the fixture must seed a remembered device').toBeTruthy()
  // One device at a time: a shared browser context must not carry another test's remembered browser.
  await page.context().clearCookies({ name: 'liwan_device' })
  await page.context().addCookies([{ name: 'liwan_device', value: token, url: 'http://localhost:44300', httpOnly: true, sameSite: 'Lax' }])
  const step = await (await page.request.post('/api/auth/login', { data: {
    login: reader ? 'e2e_employee' : 'e2e_admin',
    password: reader
      ? (process.env.E2E_USER_EMPLOYEE_PASSWORD ?? process.env.E2E_EMPLOYEE_PASSWORD ?? 'liwan-e2e-employee-2026')
      : (process.env.E2E_USER_ADMIN_PASSWORD ?? process.env.E2E_ADMIN_PASSWORD ?? 'liwan-e2e-admin-2026'),
  } })).json()
  expect(step).toEqual({ ok: false, mfa: 'code' })
  await body(await page.request.post('/api/auth/device', { data: {} }))
}
async function open(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
}
function responseFor(page: Page, path: string, method: string) {
  return page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === method)
}
function sortedQuery(url: URL) {
  return [...url.searchParams].sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
}
function assertReturnTo(page: Page, origin: string) {
  const value = new URL(page.url()).searchParams.get('returnTo')
  expect(value, 'record retains the originating list').not.toBeNull()
  const actual = new URL(value!, page.url())
  const target = new URL(origin, page.url())
  expect(actual.pathname).toBe(target.pathname)
  expect(sortedQuery(actual)).toEqual(sortedQuery(target))
  expect(actual.hash).toBe(target.hash)
}
async function atList(page: Page, origin: string) {
  const target = new URL(origin, page.url())
  await expect.poll(() => new URL(page.url()).pathname).toBe(target.pathname)
  await expect.poll(() => sortedQuery(new URL(page.url()))).toEqual(sortedQuery(target))
  expect(new URL(page.url()).hash).toBe(target.hash)
}

test('real meeting create persists and detail returns to a filtered meeting list', async ({ page }) => {
  await login(page)
  const name = `اجتماع قبول ${Date.now()}`
  await open(page, '/meetings/new')
  const panel = page.getByRole('dialog')
  await panel.locator('#meeting-name').fill(name)
  const today = await page.evaluate(() => {
    const date = new Date()
    return { iso: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`, label: new Intl.DateTimeFormat('ar', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', calendar: 'gregory', numberingSystem: 'latn' }).format(date) }
  })
  await panel.locator('#meeting-date').click()
  await page.getByRole('button', { name: today.label, exact: true }).click()
  const created = responseFor(page, '/api/v1/meetings', 'POST')
  await panel.getByRole('button', { name: 'إنشاء اجتماع', exact: true }).click()
  const meeting = await body(await created, 201)
  expect(meeting.meeting_date).toBe(today.iso)
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/meetings/${meeting.id}`)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
  const origin = `/meetings?q=${encodeURIComponent(name)}#meetings`
  await open(page, origin)
  await page.getByRole('link', { name, exact: true }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/meetings/${meeting.id}`)
  assertReturnTo(page, origin)
  await page.getByTestId('meeting-detail-back').click()
  await atList(page, origin)
  const persisted = await body(await page.request.get(`/api/v1/meetings/${meeting.id}`))
  expect(persisted.name).toBe(name)
})

test('real on-demand meeting series persists and its filtered list roundtrip stays canonical', async ({ page }) => {
  await login(page)
  const name = `سلسلة قبول ${Date.now()}`
  await open(page, '/meetings/series/new')
  const panel = page.getByRole('dialog')
  await panel.locator('#series-name').fill(name)
  const created = responseFor(page, '/api/v1/meeting-series', 'POST')
  await panel.getByRole('button', { name: 'إنشاء اجتماع دوري', exact: true }).click()
  const series = await body(await created, 201)
  expect(series.recurrence).toBe('none')
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/meetings/series/${series.id}`)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
  const origin = `/meetings/series?q=${encodeURIComponent(name)}#series`
  await open(page, origin)
  await page.getByRole('link', { name, exact: true }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/meetings/series/${series.id}`)
  assertReturnTo(page, origin)
  await page.locator('[data-slot="page-header"]').getByRole('link', { name: 'رجوع', exact: true }).click()
  await atList(page, origin)
})

test('real direct chat selects a user ID, sends and reloads the stored message for both members', async ({ page, browser }) => {
  const fixture = fixtures()
  await login(page)
  const recipients = await body(await page.request.get('/api/v1/chat/recipients'))
  const recipient = recipients.items.find((person: { id: number }) => person.id === fixture.reader)
  expect(recipient, 'seeded reader must be an eligible internal current-company user').toBeTruthy()
  await open(page, '/chat/new')
  await page.getByTestId('person-picker').click()
  await page.getByRole('combobox', { name: 'بحث', exact: true }).fill(recipient.name)
  await page.getByRole('option', { name: recipient.name }).click()
  const created = responseFor(page, '/api/v1/chat/conversations', 'POST')
  // The submit button sits outside the form element and is tied to it by the form attribute.
  await page.getByRole('button', { name: 'بدء المحادثة', exact: true }).click()
  const conversation = await body(await created, 201)
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/chat/${conversation.id}`)
  const message = `رسالة أودو محفوظة ${Date.now()}`
  await page.getByPlaceholder('اكتب رسالة').fill(message)  // the composer is a mention combobox, not a plain textbox
  const sent = responseFor(page, `/api/v1/chat/conversations/${conversation.id}/messages`, 'POST')
  await page.getByRole('button', { name: 'إرسال', exact: true }).click()
  const sentMessage = await body(await sent, 201)
  await page.reload()
  const senderRow = page.getByTestId('chat-thread').locator(`[data-message-id="${sentMessage.id}"]`)
  await expect(senderRow).toBeVisible()
  await expect(senderRow.locator('.liwan-chat-bubble')).toContainText(message)
  const peerContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
  try {
    const peer = await peerContext.newPage()
    await peer.goto(new URL('/login', page.url()).href)
    await login(peer, true)
    await open(peer, new URL(`/chat/${conversation.id}`, page.url()).href)
    const peerRow = peer.getByTestId('chat-thread').locator(`[data-message-id="${sentMessage.id}"]`)
    await expect(peerRow).toBeVisible()
    await expect(peerRow.locator('.liwan-chat-bubble')).toContainText(message)
  } finally { await peerContext.close() }
})

test('real settings invite, disable and reactivate use employee scope and enforce reader guards', async ({ page, browser }) => {
  const fixture = fixtures()
  await login(page)
  expect(fixture.grant_employee).toBeGreaterThan(0)
  const roles = await body(await page.request.get('/api/v1/admin/roles'))
  const role = roles.items.find((item: { key: string }) => item.key === 'employee')
  expect(role).toBeTruthy()
  await open(page, `/settings/team/users/new?employee_id=${fixture.grant_employee}`)
  const panel = page.getByRole('dialog')
  await panel.getByRole('checkbox', { name: role.name.ar, exact: true }).check()
  await expect(panel.locator('#password')).toHaveCount(0)
  const created = responseFor(page, '/api/v1/admin/employee-accounts', 'POST')
  await panel.getByRole('button', { name: 'إرسال الدعوة', exact: true }).click()
  const user = await body(await created, 201)
  expect(user.employee.id).toBe(fixture.grant_employee)
  expect(user.login).toBe(fixture.grant_email)
  expect(user.invitation.state).toBe('pending')
  expect(user.assignments).toEqual(expect.arrayContaining([expect.objectContaining({ role: expect.objectContaining({ id: role.id }), scope: expect.objectContaining({ id: fixture.company }) })]))
  await expect(panel.getByRole('status')).toContainText(fixture.grant_email)
  await open(page, `/settings/team/users/${user.id}/security`)
  await expect(page.locator('#admin-password')).toHaveCount(0)
  const peerContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
  try {
    const peer = await peerContext.newPage()
    await peer.goto(new URL('/login', page.url()).href)
    expect((await peer.request.post('/api/auth/login', { data: { login: fixture.grant_email, password: 'scratch-services-no-password-2026' } })).status()).toBe(401)
    await page.getByRole('button', { name: 'إيقاف الدخول', exact: true }).click()
    const disabled = responseFor(page, `/api/v1/admin/users/${user.id}/disable`, 'POST')
    await page.getByRole('button', { name: 'تأكيد', exact: true }).click()
    expect((await body(await disabled)).active).toBe(false)
    await page.getByRole('button', { name: 'إعادة تفعيل الدخول', exact: true }).click()
    const reactivated = responseFor(page, `/api/v1/admin/users/${user.id}/reactivate`, 'POST')
    await page.getByRole('button', { name: 'تأكيد', exact: true }).click()
    const restored = await body(await reactivated)
    expect(restored.active).toBe(true)
    expect(restored.invitation.state).toBe('pending')
    await login(peer, true)
    const identity = await body(await peer.request.get('/api/v1/me'))
    expect(identity.capabilities).not.toContain('access.users.read')
    expect((await peer.request.get(`/api/v1/admin/users/${fixture.admin}`)).status()).toBe(403)
    await peer.goto(new URL(`/settings/team/users/${fixture.admin}/security`, page.url()).href)
    await expect(peer.getByRole('heading', { level: 1 })).toHaveText('لا تملك صلاحية فتح هذه الصفحة')
    await expect(peer.getByRole('button', { name: 'إيقاف الدخول', exact: true })).toHaveCount(0)
  } finally { await peerContext.close() }
})
