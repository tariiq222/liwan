import { readFileSync } from 'node:fs'
import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

// Needs a real Odoo: it logs in as admin and writes data, which the mock answers with 404. It is in no CI list until it has run on a
// scratch Odoo (see docs/testing.md, section 3).
test.skip(process.env.E2E_REAL_ODOO !== '1', 'Explicit isolated real Odoo acceptance only')

const TEST_PASSWORD = 'LiwanAccess-Test-123!'
// An invited account has no password until its holder opens the emailed link, so the journeys that sign an invited user in
// read that link from a capture of the outgoing mail: a JSON-lines file (`{"to": "...", "text": "..."}`) the isolated runner
// points Odoo's outgoing mail at. Without it those journeys skip; the invitation journeys themselves need no mail.
const MAIL_OUTBOX = process.env.E2E_MAIL_OUTBOX
const NEEDS_MAIL = 'Needs E2E_MAIL_OUTBOX: the emailed invitation link sets the password'
let nextMobile = 0
function linkToken(login: string): string {
  const mails = readFileSync(MAIL_OUTBOX!, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { to: string; text: string })
  const mail = mails.reverse().find((item) => item.to.includes(login))
  const token = mail && /token=([\w-]+)/.exec(mail.text)?.[1]
  expect(token, `no emailed link for ${login} in ${MAIL_OUTBOX}`).toBeTruthy()
  return token!
}
/** The invitee's side of the link: sets a number and TEST_PASSWORD through the public accept route. */
async function acceptInvitation(request: APIRequestContext, login: string) {
  nextMobile += 1
  const mobile = `+9665${String((Date.now() + nextMobile) % 100_000_000).padStart(8, '0')}`
  const response = await request.post('/api/v1/public/account/invitation/accept', { data: { token: linkToken(login), mobile, password: TEST_PASSWORD } })
  expect(response.ok(), `accept ${login}: ${response.status()} ${await response.text()}`).toBeTruthy()
}
async function login(page: Page, login = 'admin', password = 'admin') {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill(login)
  await page.getByLabel('كلمة المرور', { exact: true }).fill(password)
  const button = page.getByRole('button', { name: 'دخول', exact: true })
  await expect(button).toBeEnabled()
  await button.click()
  await expect(page).not.toHaveURL(/\/login/)
}
async function json(request: APIRequestContext, method: 'get' | 'post' | 'patch', url: string, data?: unknown) {
  const response = await request[method](url, data === undefined ? {} : { data })
  expect(response.ok(), `${method} ${url}: ${response.status()} ${await response.text()}`).toBeTruthy()
  return response.json()
}
async function builtinRole(request: APIRequestContext, roleKey: string) {
  const roles = await json(request, 'get', '/api/v1/admin/roles?type=built_in')
  const role = roles.items.find((item: { key: string }) => item.key === roleKey)
  expect(
    role,
    `built-in role ${roleKey} missing from /api/v1/admin/roles?type=built_in (items=${roles.items.length}, total=${roles.total})`,
  ).toBeTruthy()
  return role
}
async function grantRole(request: APIRequestContext, role: { id: number }, suffix: string) {
  const me = await json(request, 'get', '/api/v1/me')
  const login = `access-${suffix}-${Date.now()}@example.test`
  const employee = await json(request, 'post', '/api/v1/hr/employees', { name: `اختبار ${suffix}`, work_email: login })
  const user = await json(request, 'post', '/api/v1/admin/employee-accounts', { employee_id: employee.id, login, assignments: [{ role_id: role.id, scope: { kind: 'company', id: me.company.id } }] })
  if (MAIL_OUTBOX) await acceptInvitation(request, login)
  return { user, employee, login }
}
async function grantFixture(request: APIRequestContext, roleKey: string, suffix: string) {
  return grantRole(request, await builtinRole(request, roleKey), suffix)
}

test('system administrator and HR have separate real API and page access', async ({ page, browser }) => {
  test.skip(!MAIL_OUTBOX, NEEDS_MAIL)
  await login(page)
  const admin = await grantFixture(page.request, 'system_admin', 'admin')
  const hr = await grantFixture(page.request, 'hr_manager', 'hr')
  const adminContext = await browser.newContext()
  const hrContext = await browser.newContext()
  try {
    const adminPage = await adminContext.newPage()
    await login(adminPage, admin.login, TEST_PASSWORD)
    await expect(adminPage).toHaveURL(/\/settings\/team\/users$/)
    await expect(adminPage.getByRole('heading', { name: 'المستخدمون', exact: true })).toBeVisible()
    const adminMe = await json(adminPage.request, 'get', '/api/v1/me')
    expect(adminMe.capabilities).not.toContain('hr.employees.manage')
    expect((await adminPage.request.post('/api/v1/hr/employees', { data: { name: 'forbidden' } })).status()).toBe(403)
    const candidates = await json(adminPage.request, 'get', '/api/v1/admin/employee-accounts/candidates')
    expect(candidates).toHaveProperty('total')
    await adminPage.goto(`/hr/employees/${admin.employee.id}/access`)
    await expect(adminPage).toHaveURL(new RegExp(`/settings/team/users/${admin.user.id}(?:\\?|$)`))
    const hrPage = await hrContext.newPage()
    await login(hrPage, hr.login, TEST_PASSWORD)
    await expect(hrPage).toHaveURL(/\/hr$/)
    expect((await hrPage.request.get('/api/v1/admin/users')).status()).toBe(403)
    expect((await hrPage.request.post(`/api/v1/hr/employees/${hr.employee.id}/access`, { data: { role: 'admin' } })).status()).toBeGreaterThanOrEqual(400)
    await hrPage.goto('/settings/team/users')
    await expect(hrPage.getByRole('heading', { name: 'المستخدمون', exact: true })).toHaveCount(0)
  } finally { await adminContext.close(); await hrContext.close() }
})

test('custom role is created through the Arabic editor and audited', async ({ page }) => {
  await login(page)
  const catalog = await json(page.request, 'get', '/api/v1/admin/permissions')
  const permission = catalog.items.find((item: { key: string }) => item.key === 'hr.employees.read')
  expect(permission).toBeTruthy()
  const name = `قارئ الدليل ${Date.now()}`
  await page.goto('/settings/team/roles/new')
  await page.getByLabel('الاسم بالعربية').fill(name)
  const createButton = page.getByRole('button', { name: 'إنشاء دور', exact: true })
  await expect(createButton).toBeEnabled()
  const checkbox = page.getByRole('checkbox', { name: new RegExp(`^${permission.label.ar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `) })
  await expect(checkbox).toBeVisible()
  await expect(checkbox).toBeEnabled()
  await checkbox.check()
  await expect(checkbox).toBeChecked()
  await createButton.click()
  await expect(page).toHaveURL(/\/settings\/team\/roles\/\d+$/)
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  const roleId = Number(new URL(page.url()).pathname.split('/').at(-1))
  const role = await json(page.request, 'get', `/api/v1/admin/roles/${roleId}`)
  expect(role.permissions).toEqual(['hr.employees.read'])
  await page.getByRole('button', { name: 'إيقاف الدور', exact: true }).click()
  await page.getByRole('button', { name: 'تأكيد', exact: true }).click()
  await expect.poll(async () => (await json(page.request, 'get', `/api/v1/admin/roles/${roleId}`)).active).toBe(false)
  await page.reload()
  await page.getByRole('button', { name: 'تفعيل الدور', exact: true }).click()
  await page.getByRole('button', { name: 'تأكيد', exact: true }).click()
  await expect.poll(async () => (await json(page.request, 'get', `/api/v1/admin/roles/${roleId}`)).active).toBe(true)
  const events = await json(page.request, 'get', `/api/v1/admin/access-log?target_type=role&target_id=${roleId}`)
  expect(events.items.some((event: { action: string }) => event.action === 'role.created')).toBe(true)
  await page.goto('/settings/team/access-log')
  await expect(page.getByRole('heading', { name: 'سجل تغييرات الوصول', exact: true })).toBeVisible()
})

test('employee preselection invites an account through the complete routed form', async ({ page, browser }) => {
  await login(page)
  const loginName = `access-form-${Date.now()}@example.test`
  const employee = await json(page.request, 'post', '/api/v1/hr/employees', { name: 'موظف تجربة منح الحساب', work_email: loginName })
  const employeeRole = await builtinRole(page.request, 'employee')
  await page.goto(`/settings/team/users/new?employee_id=${employee.id}`)
  await expect(page.locator('select#employee')).toHaveValue(String(employee.id))
  await expect(page.locator('#login')).toHaveValue(loginName)
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await page.locator(`input[type="checkbox"][value="${employeeRole.id}"]`).check()
  await page.getByRole('button', { name: 'إرسال الدعوة', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: `أرسلنا دعوة إلى ${loginName}` })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('link', { name: 'عرض المستخدم', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\/team\/users\/\d+/)
  await expect(page.getByText('بانتظار القبول').first()).toBeVisible()
  if (!MAIL_OUTBOX) return
  await acceptInvitation(page.request, loginName)
  const context = await browser.newContext()
  try {
    const employeePage = await context.newPage()
    await login(employeePage, loginName, TEST_PASSWORD)
    await expect(employeePage).toHaveURL(/\/tasks$/)
    expect((await json(employeePage.request, 'get', '/api/v1/me')).capabilities).toContain('pmo.tasks.read')
  } finally { await context.close() }
})

test('a new account is invited from name, login and roles without an employee, and cannot sign in until it accepts', async ({ page, browser }) => {
  await login(page)
  const loginName = `access-plain-${Date.now()}@example.test`
  const employeeRole = await builtinRole(page.request, 'employee')
  await page.goto('/settings/team/users/new')
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await page.locator('#name').fill('حساب بلا موظف')
  await page.locator('#login').fill(loginName)
  await page.locator(`input[type="checkbox"][value="${employeeRole.id}"]`).check()
  await page.getByRole('button', { name: 'إرسال الدعوة', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: `أرسلنا دعوة إلى ${loginName}` })).toBeVisible()
  const context = await browser.newContext()
  try {
    const stranger = await context.newPage()
    await stranger.goto('/login')
    await stranger.getByLabel('اسم المستخدم').fill(loginName)
    await stranger.getByLabel('كلمة المرور', { exact: true }).fill(TEST_PASSWORD)
    await stranger.getByRole('button', { name: 'دخول', exact: true }).click()
    await expect(stranger.getByRole('alert')).toBeVisible()
    await expect(stranger).toHaveURL(/\/login/)
    if (!MAIL_OUTBOX) return
    await acceptInvitation(page.request, loginName)
    await login(stranger, loginName, TEST_PASSWORD)
    expect((await json(stranger.request, 'get', '/api/v1/me')).capabilities).toContain('pmo.tasks.read')
  } finally { await context.close() }
})

test('account disable invalidates an existing session and leaves employee intact', async ({ page, browser }) => {
  test.skip(!MAIL_OUTBOX, NEEDS_MAIL)
  await login(page)
  const fixture = await grantFixture(page.request, 'employee', 'member')
  const context = await browser.newContext()
  try {
    const memberPage = await context.newPage()
    await login(memberPage, fixture.login, TEST_PASSWORD)
    const detail = await json(page.request, 'get', `/api/v1/admin/users/${fixture.user.id}`)
    const stopped = await json(page.request, 'post', `/api/v1/admin/users/${fixture.user.id}/disable`, { expected_version: detail.version })
    expect(stopped.active).toBe(false)
    const employee = await json(page.request, 'get', `/api/v1/hr/employees/${fixture.employee.id}`)
    expect(employee.active).toBe(true)
    expect((await memberPage.request.get('/api/v1/me')).status()).toBe(403)
  } finally { await context.close() }
})

test('navigation supports mobile inline expansion and role page reload', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)
  const toggle = page.getByRole('button', { name: 'فتح القائمة أو طيها' })
  await expect(toggle).toBeEnabled()
  await toggle.click()
  await expect(page.getByTestId('sidebar-settings')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'الانتقال إلى', exact: true }).getByRole('link', { name: 'الأدوار والصلاحيات', exact: true })).toHaveCount(0)
  await page.getByTestId('sidebar-settings').click()
  await expect(page).toHaveURL(/\/settings\/appearance$/)
  await page.getByRole('navigation').getByRole('link', { name: 'الأدوار والصلاحيات', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\/team\/roles$/)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'الأدوار والصلاحيات', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await page.screenshot({ path: testInfo.outputPath('mobile-roles.png'), fullPage: true })
})

test.describe('account security race', () => {
  test.describe.configure({ retries: 0 })

test('security page sends a reset link and reactivates the same account without any password', async ({ page }) => {
  await login(page)
  const fixture = await grantFixture(page.request, 'employee', 'security')
  await page.goto(`/settings/team/users/${fixture.user.id}/security`)
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'إرسال رابط إعادة تعيين', exact: true }).click()
  await page.getByRole('button', { name: 'تأكيد', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'أرسلنا رابط إعادة التعيين' })).toBeVisible()
  let holdMe = false
  let releaseMe: (() => void) | undefined
  let meHold: Promise<void> | undefined
  await page.route('**/api/v1/me', async (route) => {
    if (holdMe && route.request().method() === 'GET') {
      meHold ??= new Promise<void>((resolve) => { releaseMe = resolve })
      await meHold
    }
    await route.continue()
  })
  holdMe = true
  meHold = new Promise<void>((resolve) => { releaseMe = resolve })
  await page.getByRole('button', { name: 'إيقاف الدخول', exact: true }).click()
  await page.getByRole('button', { name: 'تأكيد', exact: true }).click()
  await expect(page.getByRole('button', { name: 'إيقاف الدخول', exact: true })).toBeDisabled()
  await expect(page.getByRole('status').filter({ hasText: 'تم إيقاف الوصول' })).toHaveCount(0)
  holdMe = false
  releaseMe?.()
  await expect(page.getByRole('status').filter({ hasText: 'تم إيقاف الوصول' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'إيقاف الدخول', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'إعادة تفعيل الدخول', exact: true })).toBeEnabled()
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'إعادة تفعيل الدخول', exact: true }).click()
  await page.getByRole('button', { name: 'تأكيد', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'تمت إعادة تفعيل الوصول' })).toBeVisible()
  const account = await json(page.request, 'get', `/api/v1/admin/users/${fixture.user.id}`)
  expect(account.id).toBe(fixture.user.id)
  expect(account.active).toBe(true)
  await page.goto(`/settings/team/users/${fixture.user.id}`)
  await page.goto(`/settings/team/users/${fixture.user.id}/security`)
  await expect(page.getByRole('heading', { level: 1, name: 'أمان الحساب', exact: true })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'تمت إعادة تفعيل الوصول' })).toHaveCount(0)
})
})

test('custom read-only task access is enforced in the page and direct ORM', async ({ page, browser }) => {
  test.skip(!MAIL_OUTBOX, NEEDS_MAIL)
  await login(page)
  const role = await json(page.request, 'post', '/api/v1/admin/roles', {
    name: { ar: `قراءة المهام ${Date.now()}`, en: null }, description: '',
    permissions: ['pmo.projects.read', 'pmo.tasks.read'],
  })
  const fixture = await grantRole(page.request, role, 'readonly')
  const project = await json(page.request, 'post', '/api/v1/projects', { name: `مشروع القراءة ${Date.now()}`, date_end: '2035-12-31' })
  const task = await json(page.request, 'post', '/api/v1/tasks', { name: 'مهمة للقراءة فقط', project_id: project.id })
  await json(page.request, 'patch', `/api/v1/tasks/${task.id}`, { user_ids: [fixture.user.id] })
  const context = await browser.newContext()
  try {
    const reader = await context.newPage()
    await login(reader, fixture.login, TEST_PASSWORD)
    const detail = await json(reader.request, 'get', `/api/v1/tasks/${task.id}`)
    expect(detail.can_write).toBe(false)
    expect(detail.can_approve).toBe(false)
    expect((await reader.request.patch(`/api/v1/tasks/${task.id}`, { data: { name: 'forbidden' } })).status()).toBe(403)
    const rpc = await reader.request.post('/web/dataset/call_kw/project.task/write', {
      data: { jsonrpc: '2.0', method: 'call', params: { model: 'project.task', method: 'write', args: [[task.id], { name: 'forbidden' }], kwargs: {} } },
    })
    // Odoo's generic RPC is closed for every session: a jsonrpc route answers 200 with a 404 error body.
    expect((await rpc.json()).error.code).toBe(404)
    await reader.goto(`/tasks/${task.id}`)
    await expect(reader.getByTestId('task-title-input')).toHaveCount(0)
    await expect(reader.locator('h1')).toHaveText(task.name)
    await expect(reader.getByTestId('task-menu')).toHaveCount(0)
    await expect(reader.getByRole('dialog')).toHaveCount(0)

    const directoryRole = await json(page.request, 'post', '/api/v1/admin/roles', {
      name: { ar: `دليل فقط ${Date.now()}`, en: null }, description: '', permissions: ['hr.employees.read'],
    })
    const adminMe = await json(page.request, 'get', '/api/v1/me')
    const account = await json(page.request, 'get', `/api/v1/admin/users/${fixture.user.id}`)
    await json(page.request, 'patch', `/api/v1/admin/users/${fixture.user.id}/access`, {
      assignments: [{ role_id: directoryRole.id, scope: { kind: 'company', id: adminMe.company.id } }], expected_version: account.version,
    })
    expect((await json(reader.request, 'get', '/api/v1/me')).capabilities).toEqual(['hr.employees.read'])
    await reader.goto('/account')
    await expect(reader.getByRole('navigation').getByRole('link', { name: 'مهامي', exact: true })).toHaveCount(0)
  } finally { await context.close() }
})

test('custom role save refreshes the actor Nuxt me request without focus', async ({ page, browser }) => {
  test.skip(!MAIL_OUTBOX, NEEDS_MAIL)
  await login(page)
  const catalog = await json(page.request, 'get', '/api/v1/admin/permissions')
  const directoryPermission = catalog.items.find((item: { key: string }) => item.key === 'hr.employees.read')
  expect(directoryPermission).toBeTruthy()
  const extraRole = await json(page.request, 'post', '/api/v1/admin/roles', {
    name: { ar: `صلاحيات الممثل ${Date.now()}`, en: null }, description: '', permissions: ['access.audit.read'],
  })
  const actor = await grantFixture(page.request, 'system_admin', 'actor')
  const adminMe = await json(page.request, 'get', '/api/v1/me')
  const systemAdminRole = await builtinRole(page.request, 'system_admin')
  const account = await json(page.request, 'get', `/api/v1/admin/users/${actor.user.id}`)
  await json(page.request, 'patch', `/api/v1/admin/users/${actor.user.id}/access`, {
    assignments: [
      { role_id: systemAdminRole.id, scope: { kind: 'company', id: adminMe.company.id } },
      { role_id: extraRole.id, scope: { kind: 'company', id: adminMe.company.id } },
    ],
    expected_version: account.version,
  })
  const context = await browser.newContext()
  try {
    const actorPage = await context.newPage()
    await login(actorPage, actor.login, TEST_PASSWORD)
    await actorPage.goto(`/settings/team/roles/${extraRole.id}/edit`)
    await expect(actorPage.getByRole('heading', { name: 'تعديل الدور', exact: true })).toBeVisible()
    await expect(actorPage.getByRole('navigation').getByRole('link', { name: 'الموظفون', exact: true })).toHaveCount(0)
    await actorPage.getByRole('checkbox', { name: new RegExp(`^${directoryPermission.label.ar} `) }).check()
    await expect(actorPage.getByTestId('settings-save-bar-save')).toBeEnabled()
    const savedRole = actorPage.waitForResponse((response) => (
      response.url().includes(`/api/v1/admin/roles/${extraRole.id}`) && response.request().method() === 'PATCH'
    ))
    const actorMe = actorPage.waitForRequest((request) => {
      if (request.method() !== 'GET') return false
      return new URL(request.url()).pathname.replace(/\/$/, '') === '/api/v1/me'
    })
    await actorPage.getByTestId('settings-save-bar-save').click()
    expect((await savedRole).status()).toBe(200)
    await actorMe
    await expect(actorPage.getByRole('navigation').getByRole('link', { name: 'الموظفون', exact: true })).toBeVisible()
    await expect(actorPage.locator('[data-slot="dialog-content"], [data-slot="sheet-content"]').first()).toHaveCount(0)
  } finally { await context.close() }
})
