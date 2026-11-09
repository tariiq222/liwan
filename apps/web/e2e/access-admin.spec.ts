import { test, expect, type Page, type APIRequestContext, type Browser } from '@playwright/test'
import { acceptInvitation, MAIL_OUTBOX } from './support/mailOutbox'
import { ACCEPTANCE_ORIGIN, account, fixtures, openShell, signIn, signedInPage } from './support/realOdooSession'

// Runs only on the isolated real-Odoo stack (deploy/ci/e2e-odoo.sh).
test.skip(process.env.E2E_REAL_ODOO !== '1', 'Explicit isolated real Odoo acceptance only')
test.beforeEach(async ({}, info) => { expect(new URL(String(info.project.use.baseURL)).origin).toBe(ACCEPTANCE_ORIGIN) })

const TEST_PASSWORD = 'LiwanAccess-Test-123!'
/**
 * What a password alone yields for an account this spec invited: the pending second step, and no identity.
 *
 * Every sign-in is two-step. `apps/web/server/api/auth/login.post.ts:47-51` answers a uid-less password step with
 * `{ ok: false, mfa: 'code' }` and forwards only the pre-session cookie, so `/api/v1/me` stays refused until a code
 * (`/api/auth/verify`) or a remembered device (`/api/auth/device`) finishes it —
 * `odoo-addons/liwan_api/controllers/auth.py:140-168`.
 */
async function pendingStep(request: APIRequestContext, login: string, password: string) {
  const step = await request.post('/api/auth/login', { data: { login, password } })
  expect(step.status(), await step.text()).toBe(200)
  expect(await step.json(), `the password step of ${login} must leave a pending second step`).toEqual({ ok: false, mfa: 'code' })
  expect((await request.get('/api/v1/me')).status(), 'a pending second step exposes no identity').toBe(401)
}
/**
 * Walks an invited account's password step in the real form, which is as far as this stack can take it.
 *
 * The form finishes a sign-in only through `/api/auth/device` (`apps/web/app/pages/login.vue:100-107`), and an invited
 * account has no remembered device; so the honest end of the journey is the code step, asserted here.
 */
async function invitedPasswordStep(page: Page, login: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill(login)
  await page.getByLabel('كلمة المرور', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page.getByTestId('login-send'), 'the invited account stops at the code step').toBeVisible()
  await expect(page).toHaveURL(/\/login(?:\?|$)/)
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
  if (MAIL_OUTBOX) await acceptInvitation(request, login, TEST_PASSWORD)
  return { user, employee, login }
}
async function grantFixture(request: APIRequestContext, roleKey: string, suffix: string) {
  return grantRole(request, await builtinRole(request, roleKey), suffix)
}
/** The capability keys the access admin API reports for a user: the role composition, read without that user's session. */
async function capabilityKeys(request: APIRequestContext, userId: number): Promise<string[]> {
  const detail = await json(request, 'get', `/api/v1/admin/users/${userId}`)
  return detail.capabilities.map((source: { key: string }) => source.key)
}
/** An empty context on the acceptance origin: `browser.newContext()` alone carries no baseURL for its requests. */
function invitedContext(browser: Browser) {
  return browser.newContext({ baseURL: ACCEPTANCE_ORIGIN })
}

test('custom role is created through the Arabic editor and audited', async ({ page }) => {
  await signIn(page, 'admin')
  const catalog = await json(page.request, 'get', '/api/v1/admin/permissions')
  const permission = catalog.items.find((item: { key: string }) => item.key === 'hr.employees.read')
  expect(permission).toBeTruthy()
  const name = `قارئ الدليل ${Date.now()}`
  await page.goto('/settings/team/roles/new')
  await page.getByLabel('الاسم بالعربية').fill(name)
  const createButton = page.getByRole('button', { name: 'إنشاء دور', exact: true })
  await expect(createButton).toBeEnabled()
  // A `UCheckbox` names itself from its label only (`CheckboxRoot`'s `aria-label` reads the `[for]` label's text,
  // apps/web/app/pages/settings/team/roles/new.vue:131-146): the permission label, without the description.
  const checkbox = page.getByRole('checkbox', { name: permission.label.ar, exact: true })
  await expect(checkbox).toBeVisible()
  await expect(checkbox).toBeEnabled()
  await checkbox.check()
  await expect(checkbox).toBeChecked()
  await createButton.click()
  // A created record keeps its origin, so the editor lands on the new role's record page with `?returnTo=`:
  // `navigateTo({ path: `/settings/team/roles/${role.id}`, query: { returnTo: backTo.value } })` (roles/new.vue:97).
  await expect(page).toHaveURL(/\/settings\/team\/roles\/\d+(?:\?|$)/)
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  const roleId = Number(new URL(page.url()).pathname.split('/').at(-1))
  const role = await json(page.request, 'get', `/api/v1/admin/roles/${roleId}`)
  expect(role.permissions).toEqual(['hr.employees.read'])
  // Role state changes live in the record's overflow menu (`SharedRowActions`, roles/[roleId]/index.vue:80-83): the
  // menu is labelled "إجراءات الدور {name}" and each action opens the shared confirm dialog.
  const roleMenu = page.getByRole('button', { name: `إجراءات الدور ${name}`, exact: true })
  await roleMenu.click()
  await page.getByRole('menuitem', { name: 'إيقاف الدور', exact: true }).click()
  await page.getByRole('button', { name: 'تأكيد', exact: true }).click()
  await expect.poll(async () => (await json(page.request, 'get', `/api/v1/admin/roles/${roleId}`)).active).toBe(false)
  await page.reload()
  await roleMenu.click()
  await page.getByRole('menuitem', { name: 'تفعيل الدور', exact: true }).click()
  await page.getByRole('button', { name: 'تأكيد', exact: true }).click()
  await expect.poll(async () => (await json(page.request, 'get', `/api/v1/admin/roles/${roleId}`)).active).toBe(true)
  const events = await json(page.request, 'get', `/api/v1/admin/access-log?target_type=role&target_id=${roleId}`)
  expect(events.items.some((event: { action: string }) => event.action === 'role.created')).toBe(true)
  await page.goto('/settings/team/access-log')
  await expect(page.getByRole('heading', { name: 'سجل تغييرات الوصول', exact: true })).toBeVisible()
})

test('employee preselection invites an account through the complete routed form', async ({ page, browser }) => {
  await signIn(page, 'admin')
  const loginName = `access-form-${Date.now()}@example.test`
  const employee = await json(page.request, 'post', '/api/v1/hr/employees', { name: 'موظف تجربة منح الحساب', work_email: loginName })
  const employeeRole = await builtinRole(page.request, 'employee')
  await page.goto(`/settings/team/users/new?employee_id=${employee.id}`)
  // The picker's employee control is a `USelect` (`id="employee"`, `role="combobox"`), not a native `<select>`: with
  // `?employee_id=` it pins that one candidate and shows its label (EmployeeAccountPicker.vue:38-50).
  const picker = page.locator('#employee')
  await expect(picker).toHaveRole('combobox')
  await expect(picker).toContainText(employee.name)
  await expect(picker).toContainText(loginName)
  // A pinned employee disables the free search over candidates.
  await expect(page.locator('#employee-search')).toBeDisabled()
  await expect(page.locator('#login')).toHaveValue(loginName)
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await page.getByRole('checkbox', { name: employeeRole.name.ar, exact: true }).check()
  await page.getByRole('button', { name: 'إرسال الدعوة', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: `أرسلنا دعوة إلى ${loginName}` })).toBeVisible()
  // The invite form is a route-backed create panel that stays open and renders the confirmation inside it — `sent`
  // draws a `UAlert role="status"` and the `UForm` branch is gone (users/new.vue:116-125) — so the panel itself is not
  // the thing that closes. The honest end state is that the form is unmounted: its login field no longer exists.
  await expect(page.locator('#login')).toHaveCount(0)
  await page.getByRole('link', { name: 'عرض المستخدم', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\/team\/users\/\d+/)
  const userId = Number(new URL(page.url()).pathname.split('/').at(-1))
  // The scratch stack configures no mail provider, so the invitation is recorded as attempted-and-failed while its
  // state stays `pending` (`delivery: "failed"`, `state: "pending"`). The record must show its invitation block with
  // the invitee's address, and the badge must follow the recorded delivery instead of a hardcoded "waiting".
  const detail = await json(page.request, 'get', `/api/v1/admin/users/${userId}`)
  expect(detail.invitation.state).toBe('pending')
  await expect(page.getByRole('heading', { name: 'الدعوة', exact: true })).toBeVisible()
  await expect(page.locator('main').getByText(loginName).first()).toBeVisible()
  await expect(page.getByText(detail.invitation.delivery === 'failed' ? 'لم تصل الدعوة' : 'بانتظار القبول', { exact: true }).first()).toBeVisible()
  // The employee role grants the task reads, which is what the invitee lands on once their session exists.
  expect(await capabilityKeys(page.request, userId)).toContain('pmo.tasks.read')
  if (!MAIL_OUTBOX) return
  // Opening the emailed link sets the invitee's password. Its sign-in then stops at the code step: the session behind
  // it needs a remembered device, which only the fixture's own accounts are seeded with
  // (apps/web/e2e/fixtures/real-odoo-acceptance.py:133-143). The `/tasks` landing needs that session, so it is the one
  // part of this journey this stack cannot reach.
  await acceptInvitation(page.request, loginName, TEST_PASSWORD)
  const context = await invitedContext(browser)
  try { await pendingStep(context.request, loginName, TEST_PASSWORD) } finally { await context.close() }
})

test('a new account is invited from name, login and roles without an employee, and cannot sign in until it accepts', async ({ page, browser }) => {
  await signIn(page, 'admin')
  const loginName = `access-plain-${Date.now()}@example.test`
  const employeeRole = await builtinRole(page.request, 'employee')
  await page.goto('/settings/team/users/new')
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await page.locator('#name').fill('حساب بلا موظف')
  await page.locator('#login').fill(loginName)
  // The role choices are `UCheckbox` rows labelled by the role name (users/new.vue:149-157).
  await page.getByRole('checkbox', { name: employeeRole.name.ar, exact: true }).check()
  await page.getByRole('button', { name: 'إرسال الدعوة', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: `أرسلنا دعوة إلى ${loginName}` })).toBeVisible()
  const context = await invitedContext(browser)
  try {
    const stranger = await context.newPage()
    await stranger.goto('/login')
    await stranger.getByLabel('اسم المستخدم').fill(loginName)
    await stranger.getByLabel('كلمة المرور', { exact: true }).fill(TEST_PASSWORD)
    await stranger.getByRole('button', { name: 'دخول', exact: true }).click()
    await expect(stranger.getByRole('alert')).toBeVisible()
    await expect(stranger).toHaveURL(/\/login/)
    if (!MAIL_OUTBOX) return
    // Accepted, the account has a password; a password alone is still only the pending second step, and the form stops
    // at the code step because this browser holds no remembered device for that account.
    await acceptInvitation(page.request, loginName, TEST_PASSWORD)
    await pendingStep(context.request, loginName, TEST_PASSWORD)
    await invitedPasswordStep(stranger, loginName, TEST_PASSWORD)
  } finally { await context.close() }
})

test('mobile navigation opens team roles and preserves the roles page on reload', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, 'admin')
  await openShell(page, '/')

  const toggle = page.getByTestId('mobile-navigation-trigger')
  await expect(toggle).toHaveAccessibleName('المزيد')
  await expect(toggle).toHaveAttribute('aria-haspopup', 'dialog')
  await toggle.click()
  const drawer = page.locator('#mobile-navigation')
  await expect(drawer).toBeVisible()
  await expect(page).toHaveURL(url => url.pathname === '/')

  const settings = drawer.getByTestId('mobile-navigation-app-settings')
  await expect(settings).toHaveAccessibleName('الإعدادات')
  await settings.click()
  await expect(page).toHaveURL(url => url.pathname === '/settings')
  await expect(drawer).toBeHidden()

  await page.getByTestId('settings-section-team').click()
  await expect(page).toHaveURL(url => url.pathname === '/settings/team')
  const rolesCard = page.getByTestId('team-roles-preview')
  await expect(rolesCard).toBeVisible()
  await rolesCard.getByRole('link', { name: 'كل الأدوار', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\/team\/roles$/)
  await page.reload()
  await expect(page).toHaveURL(/\/settings\/team\/roles$/)
  await expect(page.getByRole('heading', { level: 1, name: 'الأدوار والصلاحيات', exact: true })).toBeVisible()
  await expect(page.getByTestId('settings-role-new')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await page.screenshot({ path: testInfo.outputPath('mobile-roles.png'), fullPage: true })
})

test.describe('account security race', () => {
  test.describe.configure({ retries: 0 })

test('account security page offers the reset link only after acceptance and reactivates without any password', async ({ page }) => {
  await signIn(page, 'admin')
  const fixture = await grantFixture(page.request, 'employee', 'security')
  await page.goto(`/settings/team/users/${fixture.user.id}/security`)
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  if (!MAIL_OUTBOX) {
    // A reset link is offered only for an account that already accepted its invitation: the access API lists
    // `send_reset_link` for an active account that is not awaiting acceptance — `odoo-addons/liwan_api/serializers/access.py:139-140`
    // — and `_liwan_send_reset_link` answers 409 `invitation_pending` otherwise
    // (`odoo-addons/liwan_core/models/access_service.py:896-898`). Without the mail the button is absent, which is the
    // page's honest state for this fixture; the rest of the journey needs no password and runs either way.
    await expect(page.getByRole('button', { name: 'إرسال رابط إعادة تعيين', exact: true })).toHaveCount(0)
  } else {
    await page.getByRole('button', { name: 'إرسال رابط إعادة تعيين', exact: true }).click()
    await page.getByRole('button', { name: 'تأكيد', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'أرسلنا رابط إعادة التعيين' })).toBeVisible()
  }
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

test('system administrator and HR have separate real API and page access', async ({ browser }) => {
  const admin = await signedInPage(browser, 'it_admin')
  const hr = await signedInPage(browser, 'hr_manager')
  try {
    await openShell(admin.page, '/settings/team/users')
    await expect(admin.page.getByRole('heading', { name: 'المستخدمون', exact: true })).toBeVisible()
    const adminMe = await json(admin.page.request, 'get', '/api/v1/me')
    expect(adminMe.capabilities).not.toContain('hr.employees.manage')
    expect((await admin.page.request.post('/api/v1/hr/employees', { data: { name: 'forbidden' } })).status()).toBe(403)
    const candidates = await json(admin.page.request, 'get', '/api/v1/admin/employee-accounts/candidates')
    expect(candidates).toHaveProperty('total')
    await admin.page.goto(`/hr/employees/${fixtures().access_employees.it_admin}/access`)
    await expect(admin.page).toHaveURL(url => url.pathname === `/settings/team/users/${adminMe.id}`)

    await openShell(hr.page, '/hr')
    const hrMe = await json(hr.page.request, 'get', '/api/v1/me')
    expect(hrMe.capabilities).toContain('hr.employees.manage')
    expect((await hr.page.request.get('/api/v1/admin/users')).status()).toBe(403)
    const grant = await hr.page.request.post('/api/v1/admin/employee-accounts', {
      data: { employee_id: fixtures().access_employees.hr_manager, login: 'forbidden@example.test', assignments: [] },
    })
    expect(grant.status()).toBe(403)
    const usersPage = await hr.page.goto('/settings/team/users')
    expect(usersPage?.status()).toBe(403)
    await expect(hr.page.getByRole('heading', { name: 'المستخدمون', exact: true })).toHaveCount(0)
  } finally {
    await admin.context.close()
    await hr.context.close()
  }
})

test('account disable invalidates an existing session and leaves the employee intact', async ({ page, browser }) => {
  await signIn(page, 'admin')
  const member = await signedInPage(browser, 'access_member')
  try {
    const me = await json(member.page.request, 'get', '/api/v1/me')
    const detail = await json(page.request, 'get', `/api/v1/admin/users/${me.id}`)
    const stopped = await json(page.request, 'post', `/api/v1/admin/users/${me.id}/disable`, { expected_version: detail.version })
    expect(stopped.active).toBe(false)
    const employee = await json(page.request, 'get', `/api/v1/hr/employees/${fixtures().access_employees.access_member}`)
    expect(employee.active).toBe(true)
    const revoked = await member.page.request.get('/api/v1/me')
    expect(revoked.status(), await revoked.text()).toBe(401)

    const context = await invitedContext(browser)
    try {
      const login = await context.request.post('/api/auth/login', { data: account('access_member') })
      expect(login.status()).toBe(401)
    } finally {
      await context.close()
    }
  } finally {
    await member.context.close()
  }
})

async function assignRoles(request: APIRequestContext, userId: number, companyId: number, roleIds: number[]) {
  const before = await json(request, 'get', `/api/v1/admin/users/${userId}`)
  return json(request, 'patch', `/api/v1/admin/users/${userId}/access`, {
    assignments: roleIds.map(role_id => ({ role_id, scope: { kind: 'company', id: companyId } })),
    expected_version: before.version,
  })
}

test('custom read-only task access is enforced in the page and API', async ({ page, browser }) => {
  await signIn(page, 'admin')
  const reader = await signedInPage(browser, 'access_reader')
  try {
    const me = await json(reader.page.request, 'get', '/api/v1/me')
    const role = await json(page.request, 'post', '/api/v1/admin/roles', {
      name: { ar: `قراءة المهام ${Date.now()}`, en: null }, description: '',
      permissions: ['pmo.projects.read', 'pmo.tasks.read'],
    })
    await assignRoles(page.request, me.id, me.company.id, [role.id])
    const project = await json(page.request, 'post', '/api/v1/projects', { name: `مشروع القراءة ${Date.now()}`, date_end: '2035-12-31' })
    const task = await json(page.request, 'post', '/api/v1/tasks', { name: 'مهمة للقراءة فقط', project_id: project.id })
    await json(page.request, 'patch', `/api/v1/tasks/${task.id}`, { user_ids: [me.id] })

    const detail = await json(reader.page.request, 'get', `/api/v1/tasks/${task.id}`)
    expect(detail.can_write).toBe(false)
    expect(detail.can_approve).toBe(false)
    expect((await reader.page.request.patch(`/api/v1/tasks/${task.id}`, { data: { name: 'forbidden' } })).status()).toBe(403)
    const rpc = await reader.page.request.post('/web/dataset/call_kw/project.task/write', {
      data: { jsonrpc: '2.0', method: 'call', params: { model: 'project.task', method: 'write', args: [[task.id], { name: 'forbidden' }], kwargs: {} } },
    })
    expect((await rpc.json()).error.code).toBe(404)

    await openShell(reader.page, `/tasks/${task.id}`)
    const record = reader.page.getByTestId('task-detail-page')
    await expect(record.getByRole('heading', { name: task.name, exact: true })).toBeVisible()
    await expect(record.getByRole('button', { name: 'تعديل عنوان المهمة' })).toHaveCount(0)
    await expect(record.getByTestId('task-title-input')).toHaveCount(0)
    // The redesigned menu is available for read-only actions such as copying the link.
    await record.getByTestId('task-detail-menu').click()
    await expect(reader.page.getByRole('menuitem', { name: 'نسخ رابط المهمة' })).toBeVisible()
    await expect(reader.page.getByRole('menuitem', { name: 'أرشفة المهمة' })).toHaveCount(0)

    const directoryRole = await json(page.request, 'post', '/api/v1/admin/roles', {
      name: { ar: `دليل فقط ${Date.now()}`, en: null }, description: '', permissions: ['hr.employees.read'],
    })
    await assignRoles(page.request, me.id, me.company.id, [directoryRole.id])
    expect((await json(reader.page.request, 'get', '/api/v1/me')).capabilities).toEqual(['hr.employees.read'])
    expect((await reader.page.request.get(`/api/v1/tasks/${task.id}`)).status()).toBe(403)
    await openShell(reader.page, '/account/settings')
    await expect(reader.page.getByRole('navigation').getByRole('link', { name: 'مهامي', exact: true })).toHaveCount(0)
  } finally {
    await reader.context.close()
  }
})

test('custom role save refreshes the actor identity without refocusing', async ({ page, browser }) => {
  await signIn(page, 'admin')
  const catalog = await json(page.request, 'get', '/api/v1/admin/permissions')
  const directoryPermission = catalog.items.find((item: { key: string }) => item.key === 'hr.employees.read')
  expect(directoryPermission).toBeTruthy()
  const extraRole = await json(page.request, 'post', '/api/v1/admin/roles', {
    name: { ar: `صلاحيات الممثل ${Date.now()}`, en: null }, description: '', permissions: ['access.audit.read'],
  })
  const systemAdminRole = await builtinRole(page.request, 'system_admin')
  const actor = await signedInPage(browser, 'access_actor')
  try {
    const before = await json(actor.page.request, 'get', '/api/v1/me')
    await assignRoles(page.request, before.id, before.company.id, [systemAdminRole.id, extraRole.id])
    await openShell(actor.page, `/settings/team/roles/${extraRole.id}/edit`)
    await expect(actor.page.getByRole('heading', { name: 'تعديل الدور', exact: true })).toBeVisible()
    expect(before.capabilities).not.toContain(directoryPermission.key)
    const search = actor.page.locator('#global-search-input')
    const hrApp = actor.page.getByRole('option', { name: 'الموارد البشرية', exact: true })
    await actor.page.getByTestId('global-search-trigger').click()
    await search.fill('الموارد البشرية')
    await expect(hrApp).toHaveCount(0)
    await search.press('Escape')
    await expect(actor.page.getByRole('dialog')).toHaveCount(0)

    await actor.page.getByRole('checkbox', { name: directoryPermission.label.ar, exact: true }).check()
    const save = actor.page.getByTestId('settings-save-bar-save')
    await expect(save).toBeEnabled()
    const savedRole = actor.page.waitForResponse(response => (
      new URL(response.url()).pathname === `/api/v1/admin/roles/${extraRole.id}` && response.request().method() === 'PATCH'
    ))
    const refreshedIdentity = actor.page.waitForResponse(async (response) => {
      if (response.request().method() !== 'GET' || new URL(response.url()).pathname !== '/api/v1/me' || response.status() !== 200) return false
      const identity = await response.json()
      return identity.id === before.id && identity.capabilities.includes(directoryPermission.key)
    })
    await save.click()
    expect((await savedRole).status()).toBe(200)
    expect((await refreshedIdentity).status()).toBe(200)
    await expect(actor.page.getByRole('dialog')).toHaveCount(0)
    await actor.page.getByTestId('global-search-trigger').click()
    await search.fill('الموارد البشرية')
    await expect(hrApp).toBeVisible()
    await hrApp.click()
    await expect(actor.page).toHaveURL(url => url.pathname === '/hr')
    await expect(actor.page.getByRole('heading', { level: 1, name: 'دليل الموظفين', exact: true })).toBeVisible()
  } finally {
    await actor.context.close()
  }
})
