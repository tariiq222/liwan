import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

const TEST_PASSWORD = 'NasqAccess-Test-123!'
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
async function grantFixture(request: APIRequestContext, roleKey: string, suffix: string) {
  const me = await json(request, 'get', '/api/v1/me')
  const roles = await json(request, 'get', '/api/v1/admin/roles')
  const role = roles.items.find((item: { key: string }) => item.key === roleKey)
  expect(role).toBeTruthy()
  const login = `access-${suffix}-${Date.now()}@example.test`
  const employee = await json(request, 'post', '/api/v1/hr/employees', { name: `اختبار ${suffix}`, work_email: login })
  const user = await json(request, 'post', '/api/v1/admin/users', { employee_id: employee.id, password: TEST_PASSWORD, assignments: [{ role_id: role.id, scope: { kind: 'company', id: me.company.id } }] })
  return { user, employee, login }
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
  const name = `قارئ الدليل ${Date.now()}`
  await page.goto('/settings/roles/new')
  await page.getByLabel('الاسم بالعربية').fill(name)
  await page.getByRole('checkbox', { name: new RegExp(`^${permission.label.ar} `) }).check()
  await page.getByRole('button', { name: 'إنشاء دور', exact: true }).click()
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
  const roles = await json(page.request, 'get', '/api/v1/admin/roles')
  const employeeRole = roles.items.find((role: { key: string }) => role.key === 'employee')
  expect(employeeRole).toBeTruthy()
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
  await expect(page.getByRole('navigation').getByRole('link', { name: 'الأدوار والصلاحيات', exact: true })).toBeVisible()
  await page.getByRole('navigation').getByRole('link', { name: 'الأدوار والصلاحيات', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\/roles$/)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'الأدوار والصلاحيات', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await page.screenshot({ path: testInfo.outputPath('mobile-roles.png'), fullPage: true })
})

test('security page resets a password and reactivates the same account', async ({ page, browser }) => {
  await login(page)
  const fixture = await grantFixture(page.request, 'employee', 'security')
  const memberContext = await browser.newContext()
  const replacement = 'NasqAccess-Changed-456!'
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
    await page.getByRole('button', { name: 'إيقاف الدخول', exact: true }).click()
    await page.getByRole('button', { name: 'تأكيد', exact: true }).click()
    await expect(page.getByRole('button', { name: 'إعادة تفعيل الدخول', exact: true })).toBeVisible()
    await page.locator('#admin-password').fill(TEST_PASSWORD)
    await page.locator('#admin-password-confirmation').fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'إعادة تفعيل الدخول', exact: true }).click()
    await page.getByRole('button', { name: 'تأكيد', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'تمت إعادة تفعيل الوصول' })).toBeVisible()
    const account = await json(page.request, 'get', `/api/v1/admin/users/${fixture.user.id}`)
    expect(account.id).toBe(fixture.user.id)
    expect(account.active).toBe(true)
    await login(member, fixture.login, TEST_PASSWORD)
  } finally { await memberContext.close() }
})

test('custom read-only task access is enforced in the page and direct ORM', async ({ page, browser }) => {
  await login(page)
  const role = await json(page.request, 'post', '/api/v1/admin/roles', {
    name: { ar: `قراءة المهام ${Date.now()}`, en: null }, description: '',
    permissions: ['pmo.projects.read', 'pmo.tasks.read'],
  })
  const fixture = await grantFixture(page.request, role.key, 'readonly')
  const project = await json(page.request, 'post', '/api/v1/projects', { name: `مشروع القراءة ${Date.now()}` })
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
    expect((await rpc.json()).error).toBeTruthy()
    await reader.goto(`/tasks/${task.id}`)
    await expect(reader.getByLabel('عنوان المهمة')).toHaveAttribute('readonly', '')
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
