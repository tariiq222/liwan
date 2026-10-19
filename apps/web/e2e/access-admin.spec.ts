import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

const TEST_PASSWORD = 'WebVueAccess-Test-123!'
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
  const user = await json(request, 'post', '/api/v1/admin/users', { employee_id: employee.id, password: TEST_PASSWORD, assignments: [{ role_id: role.id, scope: { kind: 'company', id: me.company.id } }] })
  return { user, employee, login }
}
async function grantFixture(request: APIRequestContext, roleKey: string, suffix: string) {
  return grantRole(request, await builtinRole(request, roleKey), suffix)
}

test('system administrator and HR have separate real API and page access', async ({ page, browser }) => {
  await login(page)
  const admin = await grantFixture(page.request, 'system_admin', 'admin')
  const hr = await grantFixture(page.request, 'hr_manager', 'hr')
  const adminContext = await browser.newContext()
  const hrContext = await browser.newContext()
  try {
    const adminPage = await adminContext.newPage()
    await login(adminPage, admin.login, TEST_PASSWORD)
    await expect(adminPage).toHaveURL(/\/settings\/users$/)
    await expect(adminPage.getByRole('heading', { name: 'المستخدمون', exact: true })).toBeVisible()
    const adminMe = await json(adminPage.request, 'get', '/api/v1/me')
    expect(adminMe.capabilities).not.toContain('hr.employees.manage')
    expect((await adminPage.request.post('/api/v1/hr/employees', { data: { name: 'forbidden' } })).status()).toBe(403)
    const candidates = await json(adminPage.request, 'get', '/api/v1/admin/users/candidates')
    expect(candidates).toHaveProperty('total')
    await adminPage.goto(`/hr/employees/${admin.employee.id}/access`)
    await expect(adminPage).toHaveURL(new RegExp(`/settings/users/${admin.user.id}(?:\\?|$)`))
    const hrPage = await hrContext.newPage()
    await login(hrPage, hr.login, TEST_PASSWORD)
    await expect(hrPage).toHaveURL(/\/hr$/)
    expect((await hrPage.request.get('/api/v1/admin/users')).status()).toBe(403)
    expect((await hrPage.request.post(`/api/v1/hr/employees/${hr.employee.id}/access`, { data: { role: 'admin', password: TEST_PASSWORD } })).status()).toBeGreaterThanOrEqual(400)
    await hrPage.goto('/settings/users')
    await expect(hrPage.getByRole('heading', { name: 'المستخدمون', exact: true })).toHaveCount(0)
  } finally { await adminContext.close(); await hrContext.close() }
})

test('custom role is created through the Arabic editor and audited', async ({ page }) => {
  await login(page)
  const catalog = await json(page.request, 'get', '/api/v1/admin/permissions')
  const permission = catalog.items.find((item: { key: string }) => item.key === 'hr.employees.read')
  expect(permission).toBeTruthy()
  const name = `قارئ الدليل ${Date.now()}`
  await page.goto('/settings/roles/new')
  await page.getByLabel('الاسم بالعربية').fill(name)
  const createButton = page.getByRole('button', { name: 'إنشاء دور', exact: true })
  await expect(createButton).toBeEnabled()
  const checkbox = page.getByRole('checkbox', { name: new RegExp(`^${permission.label.ar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `) })
  await expect(checkbox).toBeVisible()
  await expect(checkbox).toBeEnabled()
  await checkbox.check()
  await expect(checkbox).toBeChecked()
  await createButton.click()
  await expect(page).toHaveURL(/\/settings\/roles\/\d+$/)
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
  await page.goto('/settings/access-log')
  await expect(page.getByRole('heading', { name: 'سجل تغييرات الوصول', exact: true })).toBeVisible()
})

test('employee preselection grants an account through the complete routed form', async ({ page, browser }) => {
  await login(page)
  const loginName = `access-form-${Date.now()}@example.test`
  const employee = await json(page.request, 'post', '/api/v1/hr/employees', { name: 'موظف تجربة منح الحساب', work_email: loginName })
  const employeeRole = await builtinRole(page.request, 'employee')
  await page.goto(`/settings/users/new?employee_id=${employee.id}`)
  await expect(page.locator('select#employee')).toHaveValue(String(employee.id))
  await page.locator(`input[type="checkbox"][value="${employeeRole.id}"]`).check()
  await page.locator('#password').fill(TEST_PASSWORD)
  await page.locator('#password-confirmation').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'منح حساب لموظف', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\/users\/\d+$/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const context = await browser.newContext()
  try {
    const employeePage = await context.newPage()
    await login(employeePage, loginName, TEST_PASSWORD)
    await expect(employeePage).toHaveURL(/\/tasks$/)
    expect((await json(employeePage.request, 'get', '/api/v1/me')).capabilities).toContain('pmo.tasks.read')
  } finally { await context.close() }
})

test('account disable invalidates an existing session and leaves employee intact', async ({ page, browser }) => {
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
  await expect(page).toHaveURL(/\/settings\/roles$/)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'الأدوار والصلاحيات', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await page.screenshot({ path: testInfo.outputPath('mobile-roles.png'), fullPage: true })
})

test.describe('account security race', () => {
  test.describe.configure({ retries: 0 })

test('security page resets a password and reactivates the same account', async ({ page, browser }) => {
  await login(page)
  const fixture = await grantFixture(page.request, 'employee', 'security')
  const memberContext = await browser.newContext()
  const replacement = 'WebVueAccess-Changed-456!'
  try {
    const member = await memberContext.newPage()
    await login(member, fixture.login, TEST_PASSWORD)
    await page.goto(`/settings/users/${fixture.user.id}/security`)
    await page.locator('#admin-password').fill(replacement)
    await page.locator('#admin-password-confirmation').fill(replacement)
    await page.getByRole('button', { name: 'إعادة تعيين كلمة المرور', exact: true }).click()
    await page.getByRole('button', { name: 'تأكيد', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'تمت إعادة تعيين كلمة المرور' })).toBeVisible()
    expect((await member.request.get('/api/v1/me')).status()).toBe(403)
    await expect(page.locator('#admin-password')).toHaveValue('')
    await login(member, fixture.login, replacement)
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
    await expect(page.getByRole('button', { name: 'إعادة تفعيل الدخول', exact: true })).toBeVisible()
    await page.locator('#admin-password').fill(TEST_PASSWORD)
    await page.locator('#admin-password-confirmation').fill(TEST_PASSWORD)
    await expect(page.getByRole('button', { name: 'إعادة تفعيل الدخول', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'إعادة تفعيل الدخول', exact: true }).click()
    await page.getByRole('button', { name: 'تأكيد', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'تمت إعادة تفعيل الوصول' })).toBeVisible()
    const account = await json(page.request, 'get', `/api/v1/admin/users/${fixture.user.id}`)
    expect(account.id).toBe(fixture.user.id)
    expect(account.active).toBe(true)
    await login(member, fixture.login, TEST_PASSWORD)
    await page.goto(`/settings/users/${fixture.user.id}`)
    await page.goto(`/settings/users/${fixture.user.id}/security`)
    await expect(page.getByRole('heading', { level: 1, name: 'أمان الحساب', exact: true })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'تمت إعادة تفعيل الوصول' })).toHaveCount(0)
  } finally { await memberContext.close() }
})
})

test('custom read-only task access is enforced in the page and direct ORM', async ({ page, browser }) => {
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
    await actorPage.goto(`/settings/roles/${extraRole.id}/edit`)
    await expect(actorPage.getByRole('heading', { name: 'تعديل الدور', exact: true })).toBeVisible()
    await expect(actorPage.getByRole('navigation').getByRole('link', { name: 'الموظفون', exact: true })).toHaveCount(0)
    await actorPage.getByRole('checkbox', { name: new RegExp(`^${directoryPermission.label.ar} `) }).check()
    await expect(actorPage.getByRole('button', { name: 'حفظ', exact: true })).toBeEnabled()
    const savedRole = actorPage.waitForResponse((response) => (
      response.url().includes(`/api/v1/admin/roles/${extraRole.id}`) && response.request().method() === 'PATCH'
    ))
    const actorMe = actorPage.waitForRequest((request) => {
      if (request.method() !== 'GET') return false
      return new URL(request.url()).pathname.replace(/\/$/, '') === '/api/v1/me'
    })
    await actorPage.getByRole('button', { name: 'حفظ', exact: true }).click()
    expect((await savedRole).status()).toBe(200)
    await actorMe
    await expect(actorPage.getByRole('navigation').getByRole('link', { name: 'الموظفون', exact: true })).toBeVisible()
    await expect(actorPage.locator('[data-slot="dialog-content"], [data-slot="sheet-content"]').first()).toHaveCount(0)
  } finally { await context.close() }
})
