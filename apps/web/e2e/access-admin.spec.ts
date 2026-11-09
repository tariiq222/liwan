import { test, expect, type Page, type APIRequestContext, type Browser } from '@playwright/test'
import { acceptInvitation, MAIL_OUTBOX } from './support/mailOutbox'
import { ACCEPTANCE_ORIGIN, openShell, signIn } from './support/realOdooSession'

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

/*
 * The mobile journey the product actually offers: one drawer (`#mobile-navigation`) opened from the header trigger and
 * fed by the same permission-filtered menu as the desktop sidebar (apps/web/app/components/shell/MobileNavigation.vue
 * renders `ShellNavigation surface="drawer"`), a settings branch that expands in place, and the roles list reached by
 * clicks only. Per-user appearance is not part of this surface any more: it moved to `/account/settings` (618f651d7),
 * so no `/settings/appearance` page or `sidebar-settings` testid is asserted here.
 */
test('navigation supports mobile inline expansion and role page reload', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, 'admin')
  await openShell(page, '/')
  const toggle = page.getByTestId('mobile-navigation-trigger')
  // `aria-label` is `nav.openMenu` («فتح القائمة»), not the desktop sidebar's `nav.toggleSidebar` (MobileNavigation.vue:16).
  await expect(toggle).toHaveAttribute('aria-label', 'فتح القائمة')
  await expect(toggle).toBeEnabled()
  await expect(toggle).toHaveAttribute('aria-controls', 'mobile-navigation')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const drawer = page.locator('#mobile-navigation')
  await expect(drawer).toBeVisible()
  // The menu list's accessible name is `nav.apps` («التطبيقات»): MobileNavigation passes no `title`, and
  // ShellNavigation labels its `<nav>` with that key (ShellNavigation.vue:105).
  const apps = drawer.getByRole('navigation', { name: 'التطبيقات', exact: true })
  await expect(apps).toBeVisible()
  // The destinations verified at 390×844, by the row hook `mobile-navigation-app-<rail id>` and the label each
  // manifest declares for it (the drawer carries the identity's other applications too, e.g. `ai` and `inbox`).
  const destinations: Array<[string, string]> = [
    ['meetings', 'الاجتماعات'], ['tasks', 'مهامي'], ['projects', 'المشاريع'], ['chat', 'المحادثات'],
    ['hr', 'الموارد البشرية'], ['operations', 'العمليات'], ['appointments', 'المواعيد'],
    ['documents', 'المستندات'], ['settings', 'الإعدادات'],
  ]
  for (const [id, label] of destinations) {
    const row = apps.getByTestId(`mobile-navigation-app-${id}`)
    await expect(row).toBeVisible()
    await expect(row).toContainText(label)
  }
  // Settings is a disclosure, not a link: `UCollapsible` hands `aria-expanded` to the row, and expanding it opens the
  // settings pages in place while the drawer stays on the page. No team part is listed before that.
  await expect(drawer.getByTestId('mobile-settings-context-link-roles')).toHaveCount(0)
  const settingsRow = apps.getByTestId('mobile-navigation-app-settings')
  await expect(settingsRow).toHaveAttribute('aria-expanded', 'false')
  await settingsRow.click()
  await expect(settingsRow).toHaveAttribute('aria-expanded', 'true')
  await expect(drawer.getByTestId('mobile-navigation-submenu-settings')).toBeVisible()
  expect(new URL(page.url()).pathname, 'expanding a branch must not navigate').toBe('/')
  // «الفريق والصلاحيات» has children too: a page row's parts come from that page's own context links
  // (`applicationNavigation` → `contextAt(row.to)`), so the row is a disclosure and expands its parts in place — still
  // no navigation. Only the opened branch shows its rows (`ShellContextSubList` opens one path at a time), under the
  // nested `${prefix}submenu-<ids>` hook.
  const team = drawer.getByTestId('context-link-settings-team')
  await expect(team).toContainText('الفريق والصلاحيات')
  await expect(team).toHaveAttribute('aria-expanded', 'false')
  await team.click()
  await expect(team).toHaveAttribute('aria-expanded', 'true')
  await expect(drawer.getByTestId('mobile-settings-submenu-settings-team')).toBeVisible()
  expect(new URL(page.url()).pathname, 'expanding a branch must not navigate').toBe('/')
  // The roles part links to the team page's roles card (`settingsPartTarget` keeps a part with a `within` page on its
  // card: `{ path: '/settings/team', hash: '#roles' }`), so choosing it navigates and the drawer closes with the route
  // (`watch(() => route.fullPath)`). The card's own «كل الأدوار» link then opens the full list — clicks only, no `goto`.
  // A nested row's hook keeps the parent prefix (`ShellContextSubList.rowTestId`), so the drawer's copy is distinct
  // from the desktop sidebar's.
  const roles = drawer.getByTestId('mobile-settings-context-link-roles')
  await expect(roles).toContainText('الأدوار والصلاحيات')
  await roles.click()
  await expect(drawer).toBeHidden()
  // The card the part named is on the team page it opens (the hash is the scroll-spy's from here on).
  expect(new URL(page.url()).pathname, 'the roles part opens the team page at its roles card').toBe('/settings/team')
  const rolesCard = page.getByTestId('team-roles-preview')
  await expect(rolesCard).toBeVisible()
  await rolesCard.getByRole('link', { name: 'كل الأدوار', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\/team\/roles$/)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'الأدوار والصلاحيات', exact: true })).toBeVisible()
  // The role list's own create action, so a blank page cannot satisfy this journey.
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

/**
 * The four journeys below originally drove two invited accounts' pages. An invited account cannot be signed in on this
 * stack: accepting the invitation writes a password and a mobile number, never a remembered device
 * (odoo-addons/liwan_core/models/access_service.py:960-965), and only `/api/auth/verify` with a code or
 * `/api/auth/device` with a seeded token finishes a sign-in (odoo-addons/liwan_api/controllers/auth.py:140-168). Each
 * journey therefore asserts what the access API proves without that session, and names the browser half it cannot run.
 */
test('system administrator and HR have separate real API access', async ({ page }) => {
  await signIn(page, 'admin')
  const admin = await grantFixture(page.request, 'system_admin', 'sysadmin')
  const hr = await grantFixture(page.request, 'hr_manager', 'hr')
  // The grants are read from the access API's own per-account detail (`dump_admin_user`), so proving they do not leak
  // into each other needs no session of theirs.
  const adminDetail = await json(page.request, 'get', `/api/v1/admin/users/${admin.user.id}`)
  const adminKeys = adminDetail.capabilities.map((source: { key: string }) => source.key)
  expect(adminKeys).not.toContain('hr.employees.manage')
  expect(adminKeys).toContain('access.users.read')
  const hrDetail = await json(page.request, 'get', `/api/v1/admin/users/${hr.user.id}`)
  const hrKeys = hrDetail.capabilities.map((source: { key: string }) => source.key)
  expect(hrKeys).toContain('hr.employees.manage')
  expect(hrKeys).not.toContain('access.users.read')
  // Neither account has accepted yet, which is why neither can be signed in here: an unopened invitation is `pending`
  // (`odoo-addons/liwan_core/models/access_service.py:662-678`), and opening it still only sets a password.
  expect(adminDetail.invitation?.state ?? null).toBe(MAIL_OUTBOX ? null : 'pending')
  expect(hrDetail.invitation?.state ?? null).toBe(MAIL_OUTBOX ? null : 'pending')
  // Not run here: the page half of this journey — the invited administrator landing on /settings/team/users,
  // `/hr/employees/<id>/access` redirecting to that user, and the HR page answering 403 on /api/v1/admin/users while
  // hiding the users heading — needs those two sessions, which this stack cannot issue.
})

test('account disable stops the sign-in and leaves the employee intact', async ({ page, browser }) => {
  await signIn(page, 'admin')
  const fixture = await grantFixture(page.request, 'employee', 'member')
  const detail = await json(page.request, 'get', `/api/v1/admin/users/${fixture.user.id}`)
  const stopped = await json(page.request, 'post', `/api/v1/admin/users/${fixture.user.id}/disable`, { expected_version: detail.version })
  expect(stopped.active).toBe(false)
  const employee = await json(page.request, 'get', `/api/v1/hr/employees/${fixture.employee.id}`)
  expect(employee.active).toBe(true)
  const context = await invitedContext(browser)
  try {
    // Only once the invitation was opened is the password a real credential, so the refusal is the account's state
    // and not a password nobody ever set: a disabled account cannot start a sign-in at all.
    if (MAIL_OUTBOX) {
      expect((await context.request.post('/api/auth/login', { data: { login: fixture.login, password: TEST_PASSWORD } })).status()).toBe(401)
    }
    expect((await context.request.get('/api/v1/me')).status()).toBe(401)
  } finally { await context.close() }
  // Not run here: the "invalidates an existing session" half, which needs the member signed in before the disable.
})

test('custom read-only task access is enforced in the API and direct ORM', async ({ page }) => {
  await signIn(page, 'admin')
  const role = await json(page.request, 'post', '/api/v1/admin/roles', {
    name: { ar: `قراءة المهام ${Date.now()}`, en: null }, description: '',
    permissions: ['pmo.projects.read', 'pmo.tasks.read'],
  })
  const fixture = await grantRole(page.request, role, 'readonly')
  const project = await json(page.request, 'post', '/api/v1/projects', { name: `مشروع القراءة ${Date.now()}`, date_end: '2035-12-31' })
  const task = await json(page.request, 'post', '/api/v1/tasks', { name: 'مهمة للقراءة فقط', project_id: project.id })
  await json(page.request, 'patch', `/api/v1/tasks/${task.id}`, { user_ids: [fixture.user.id] })
  // The custom role grants exactly the two reads, through one company-scoped assignment, and nothing else.
  expect(await capabilityKeys(page.request, fixture.user.id)).toEqual(['pmo.projects.read', 'pmo.tasks.read'])
  const account = await json(page.request, 'get', `/api/v1/admin/users/${fixture.user.id}`)
  expect(account.assignments).toEqual([expect.objectContaining({ role: expect.objectContaining({ id: role.id }) })])
  // Odoo's generic RPC is closed for every session, the administrator's included: a jsonrpc route answers 200 with a
  // 404 error body, so the direct ORM write never runs.
  const rpc = await page.request.post('/web/dataset/call_kw/project.task/write', {
    data: { jsonrpc: '2.0', method: 'call', params: { model: 'project.task', method: 'write', args: [[task.id], { name: 'forbidden' }], kwargs: {} } },
  })
  expect((await rpc.json()).error.code).toBe(404)
  // Not run here: the reader's own `can_write`/`can_approve`, the 403 on their PATCH, the read-only task page and the
  // `['hr.employees.read']` re-grant all need the reader signed in, which needs their remembered device.
})

test('custom role save applies through the access API without a new login', async ({ page }) => {
  await signIn(page, 'admin')
  const extraRole = await json(page.request, 'post', '/api/v1/admin/roles', {
    name: { ar: `صلاحيات الممثل ${Date.now()}`, en: null }, description: '', permissions: ['access.audit.read'],
  })
  const actor = await grantFixture(page.request, 'system_admin', 'actor')
  const adminMe = await json(page.request, 'get', '/api/v1/me')
  const systemAdminRole = await builtinRole(page.request, 'system_admin')
  const before = await json(page.request, 'get', `/api/v1/admin/users/${actor.user.id}`)
  // The save composes both roles and records the change in the access audit the roles page reads.
  const saved = await json(page.request, 'patch', `/api/v1/admin/users/${actor.user.id}/access`, {
    assignments: [
      { role_id: systemAdminRole.id, scope: { kind: 'company', id: adminMe.company.id } },
      { role_id: extraRole.id, scope: { kind: 'company', id: adminMe.company.id } },
    ],
    expected_version: before.version,
  })
  expect(saved.assignments.map((assignment: { role: { id: number } }) => assignment.role.id).sort()).toEqual([extraRole.id, systemAdminRole.id].sort())
  const events = await json(page.request, 'get', `/api/v1/admin/access-log?target_type=user&target_id=${actor.user.id}&action=user.roles_changed`)
  expect(events.items, `no user.roles_changed audit event for user ${actor.user.id}`).not.toHaveLength(0)
  const detail = await json(page.request, 'get', `/api/v1/admin/access-log/${events.items[0].id}`)
  expect(detail.after.assignments.map((entry: { role_id: number }) => entry.role_id).sort()).toEqual([extraRole.id, systemAdminRole.id].sort())
  // Not run here: the browser half (the actor's `/api/v1/me` refreshing after the save bar, without a window focus,
  // and the navigation link appearing) needs the actor signed in, which needs their remembered device.
})
