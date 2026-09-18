import { expect, test, type Browser, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
const TEST_PASSWORD = 'NasqPsc-E2E-123!'

test.setTimeout(120_000)

async function login(page: Page, username = ADMIN_LOGIN, password = ADMIN_PASSWORD) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill(username)
  await page.getByLabel('كلمة المرور').fill(password)
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function json(page: Page, method: 'get' | 'post' | 'patch', url: string, data?: unknown) {
  const response = await page.request[method](url, data === undefined ? {} : { data })
  expect(response.ok(), `${method} ${url}: ${response.status()} ${await response.text()}`).toBeTruthy()
  return response.json()
}

async function grantUser(page: Page, roleKey: string, suffix: string) {
  const me = await json(page, 'get', '/api/v1/me')
  const roles = await json(page, 'get', '/api/v1/admin/roles')
  const role = roles.items.find((item: { key: string }) => item.key === roleKey)
  expect(role).toBeTruthy()
  const stamp = Date.now()
  const loginName = `psc-${suffix}-${stamp}@example.test`
  const employee = await json(page, 'post', '/api/v1/hr/employees', { name: `PSC ${suffix} ${stamp}`, work_email: loginName })
  const user = await json(page, 'post', '/api/v1/admin/users', {
    employee_id: employee.id,
    password: TEST_PASSWORD,
    assignments: [{ role_id: role.id, scope: { kind: 'company', id: me.company.id } }],
  })
  return { user, login: loginName, employee, me }
}

async function loginContext(browser: Browser, username: string, password: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await login(page, username, password)
  const me = await json(page, 'get', '/api/v1/me')
  return { context, page, me }
}

test('create form requires a real calendar day and explains creation-only defaults', async ({ page }) => {
  await login(page)
  await page.goto('/projects/new')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'مشروع جديد' })).toBeVisible()
  await expect(page.getByTestId('project-create-form')).toBeVisible()
  await expect(page.getByTestId('project-create-defaults-error')).toHaveCount(0)
  await expect(page.getByText(/عند الإنشاء فقط|only at creation/i)).toBeVisible()
  const name = `PSC create ${Date.now()}`
  await page.getByTestId('project-create-name').fill(name)
  await page.getByTestId('project-create-end-date').click()
  await page.locator('[data-slot="calendar-cell-trigger"]:not([data-outside-view])').nth(10).click()
  await page.getByTestId('project-create-submit').click()
  await expect(page).toHaveURL(/\/projects\/\d+/)
})

test('end-only create then date edit persists after reload', async ({ page }) => {
  await login(page)
  await page.goto('/projects/new')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'مشروع جديد' })).toBeVisible()
  await expect(page.getByTestId('project-create-form')).toBeVisible()
  const name = `PSC lone end ${Date.now()}`
  await page.getByTestId('project-create-name').fill(name)
  await page.getByTestId('project-create-end-date').click()
  await page.locator('[data-slot="calendar-cell-trigger"]:not([data-outside-view])').nth(12).click()
  await page.getByTestId('project-create-submit').click()
  await expect(page).toHaveURL(/\/projects\/\d+/)
  const id = Number(page.url().match(/\/projects\/(\d+)/)?.[1])
  await page.goto(`/projects/${id}/settings`)
  const endButton = page.getByRole('button', { name: 'تاريخ الانتهاء' })
  await expect(endButton).toBeVisible()
  const before = (await endButton.innerText()).trim()
  await endButton.click()
  await page.locator('[data-slot="calendar-cell-trigger"]:not([data-outside-view])').nth(14).click()
  await expect.poll(async () => (await endButton.innerText()).trim()).not.toBe(before)
  const after = (await endButton.innerText()).trim()
  await page.reload()
  await expect(page.getByRole('button', { name: 'تاريخ الانتهاء' })).toHaveText(after)
  const detail = await json(page, 'get', `/api/v1/projects/${id}`)
  expect(detail.date_start).toBeNull()
  expect(detail.date_end).toBeTruthy()
})

test('assignee is not the reviewer: request, return with note, resubmit, accept', async ({ page, browser }) => {
  await login(page)
  const adminMe = await json(page, 'get', '/api/v1/me')
  const emp = await grantUser(page, 'employee', 'emp')
  const mgr = await grantUser(page, 'pmo_manager', 'mgr')
  expect(emp.user.id).not.toBe(mgr.user.id)
  const project = await json(page, 'post', '/api/v1/projects', {
    name: `PSC two-user ${Date.now()}`, date_end: '2035-12-31', user_id: mgr.user.id,
  })
  await json(page, 'patch', `/api/v1/projects/${project.id}`, { nasq_completion_approval: 'project_manager' })
  const task = await json(page, 'post', '/api/v1/tasks', { name: `PSC two-user task ${Date.now()}`, project_id: project.id })
  await json(page, 'patch', `/api/v1/tasks/${task.id}`, { user_ids: [emp.user.id] })

  const empSession = await loginContext(browser, emp.login, TEST_PASSWORD)
  const mgrSession = await loginContext(browser, mgr.login, TEST_PASSWORD)
  try {
    expect(empSession.me.id).not.toBe(mgrSession.me.id)
    expect(empSession.me.id).not.toBe(adminMe.id)
    await empSession.page.goto(`/tasks/${task.id}`)
    await expect(empSession.page.getByTestId('task-completion')).toBeVisible()
    await empSession.page.getByTestId('task-completion-request').click()
    await expect(empSession.page.getByTestId('task-completion-request')).toHaveCount(0)
    await mgrSession.page.goto(`/tasks/${task.id}`)
    await expect(mgrSession.page.getByTestId('task-completion-accept')).toBeVisible()
    await expect(mgrSession.page.getByTestId('task-completion-return')).toBeVisible()
    await mgrSession.page.getByTestId('task-completion-note').fill('يرجى التوضيح')
    await mgrSession.page.getByTestId('task-completion-return').click()
    await expect(mgrSession.page.getByText(/أُعيدت/)).toBeVisible()
    await empSession.page.reload()
    await empSession.page.getByTestId('task-completion-request').click()
    await mgrSession.page.reload()
    await mgrSession.page.getByTestId('task-completion-accept').click()
    await expect(mgrSession.page.getByText('منجز')).toBeVisible()
  } finally {
    await empSession.context.close()
    await mgrSession.context.close()
  }
})

test('self-approval is allowed for the designated manager assignee', async ({ page }) => {
  await login(page)
  const me = await json(page, 'get', '/api/v1/me')
  const project = await json(page, 'post', '/api/v1/projects', {
    name: `PSC self ${Date.now()}`, date_end: '2035-12-31', user_id: me.id,
  })
  await json(page, 'patch', `/api/v1/projects/${project.id}`, { nasq_completion_approval: 'project_manager' })
  const task = await json(page, 'post', '/api/v1/tasks', { name: `PSC self task ${Date.now()}`, project_id: project.id })
  await page.goto(`/tasks/${task.id}`)
  await page.getByTestId('task-completion-request').click()
  await page.getByTestId('task-completion-accept').click()
  await expect(page.getByText('منجز')).toBeVisible()
})

test('specific_user picker saves another eligible reviewer, not the project manager', async ({ page, browser }) => {
  await login(page)
  const emp = await grantUser(page, 'employee', 'su-emp')
  const mgr = await grantUser(page, 'pmo_manager', 'su-mgr')
  const reviewer = await grantUser(page, 'pmo_manager', 'su-rev')
  expect(reviewer.user.id).not.toBe(mgr.user.id)
  const project = await json(page, 'post', '/api/v1/projects', {
    name: `PSC specific ${Date.now()}`, date_end: '2035-12-31', user_id: mgr.user.id,
  })
  await page.goto(`/projects/${project.id}/settings`)
  await page.getByTestId('project-approval-mode').click()
  await page.getByRole('option', { name: 'مستخدم محدد' }).click()
  await expect(page.getByTestId('project-approver')).toBeVisible()
  await page.getByTestId('project-approver').click()
  const picker = page.locator('[data-slot="popover-content"]').last()
  await picker.getByPlaceholder('بحث').fill(reviewer.employee.name)
  await expect(picker.getByText(reviewer.employee.name, { exact: true })).toHaveCount(1)
  await picker.getByText(reviewer.employee.name, { exact: true }).click()
  await page.reload()
  await expect(page.getByTestId('project-approval-mode')).toContainText('مستخدم محدد')
  await expect(page.getByTestId('project-approver')).toContainText(reviewer.employee.name)
  const task = await json(page, 'post', '/api/v1/tasks', { name: `PSC specific task ${Date.now()}`, project_id: project.id })
  await json(page, 'patch', `/api/v1/tasks/${task.id}`, { user_ids: [emp.user.id] })
  const empSession = await loginContext(browser, emp.login, TEST_PASSWORD)
  const revSession = await loginContext(browser, reviewer.login, TEST_PASSWORD)
  const mgrSession = await loginContext(browser, mgr.login, TEST_PASSWORD)
  try {
    await empSession.page.goto(`/tasks/${task.id}`)
    await expect(empSession.page.getByTestId('task-completion-request')).toBeVisible()
    await empSession.page.getByTestId('task-completion-request').click()
    await expect(empSession.page.getByTestId('task-completion-pending')).toBeVisible()
    await revSession.page.goto(`/tasks/${task.id}`)
    await expect(revSession.page.getByTestId('task-completion-accept')).toBeVisible()
    await mgrSession.page.goto(`/tasks/${task.id}`)
    await expect(mgrSession.page.getByTestId('task-completion-accept')).toHaveCount(0)
    await revSession.page.getByTestId('task-completion-accept').click()
    await expect(revSession.page.getByText('منجز')).toBeVisible()
  } finally {
    await empSession.context.close()
    await revSession.context.close()
    await mgrSession.context.close()
  }
})

test('cancelled pending request rejects a stale accept in the UI', async ({ page, browser }) => {
  await login(page)
  const emp = await grantUser(page, 'employee', 'cancel')
  const mgr = await grantUser(page, 'pmo_manager', 'cancel-mgr')
  const project = await json(page, 'post', '/api/v1/projects', {
    name: `PSC cancel ${Date.now()}`, date_end: '2035-12-31', user_id: mgr.user.id,
  })
  await json(page, 'patch', `/api/v1/projects/${project.id}`, { nasq_completion_approval: 'project_manager' })
  const task = await json(page, 'post', '/api/v1/tasks', { name: `PSC cancel task ${Date.now()}`, project_id: project.id })
  await json(page, 'patch', `/api/v1/tasks/${task.id}`, { user_ids: [emp.user.id] })
  const empSession = await loginContext(browser, emp.login, TEST_PASSWORD)
  const mgrSession = await loginContext(browser, mgr.login, TEST_PASSWORD)
  try {
    await empSession.page.goto(`/tasks/${task.id}`)
    await empSession.page.getByTestId('task-completion-request').click()
    await expect(empSession.page.getByTestId('task-completion-pending')).toBeVisible()
    const cancelled = await mgrSession.page.request.post(`/api/v1/tasks/${task.id}/transition`, { data: { state: 'cancelled' } })
    expect(cancelled.ok()).toBeTruthy()
    await mgrSession.page.goto(`/tasks/${task.id}`)
    await expect(mgrSession.page.getByTestId('task-completion-accept')).toHaveCount(0)
    const stale = await mgrSession.page.request.post(`/api/v1/tasks/${task.id}/completion/accept`, { data: { revision: 1 } })
    expect(stale.status()).toBeGreaterThanOrEqual(400)
  } finally {
    await empSession.context.close()
    await mgrSession.context.close()
  }
})

test('withdraw while reviewer is blocked then resubmit after repair', async ({ page, browser }) => {
  await login(page)
  const emp = await grantUser(page, 'employee', 'wd')
  const mgr = await grantUser(page, 'pmo_manager', 'wd-mgr')
  const project = await json(page, 'post', '/api/v1/projects', {
    name: `PSC withdraw ${Date.now()}`, date_end: '2035-12-31', user_id: mgr.user.id,
  })
  await json(page, 'patch', `/api/v1/projects/${project.id}`, { nasq_completion_approval: 'project_manager' })
  const task = await json(page, 'post', '/api/v1/tasks', { name: `PSC withdraw task ${Date.now()}`, project_id: project.id })
  await json(page, 'patch', `/api/v1/tasks/${task.id}`, { user_ids: [emp.user.id] })
  const empSession = await loginContext(browser, emp.login, TEST_PASSWORD)
  try {
    await empSession.page.goto(`/tasks/${task.id}`)
    await empSession.page.getByTestId('task-completion-request').click()
    await expect(empSession.page.getByTestId('task-completion-pending')).toBeVisible()
    const account = await json(page, 'get', `/api/v1/admin/users/${mgr.user.id}`)
    await json(page, 'post', `/api/v1/admin/users/${mgr.user.id}/disable`, { expected_version: account.version })
    await empSession.page.reload()
    await expect(empSession.page.getByTestId('task-completion-blocked')).toBeVisible()
    await empSession.page.getByTestId('task-completion-withdraw').click()
    await expect(empSession.page.getByTestId('task-completion-withdraw')).toHaveCount(0)
    const disabled = await json(page, 'get', `/api/v1/admin/users/${mgr.user.id}`)
    await json(page, 'post', `/api/v1/admin/users/${mgr.user.id}/reactivate`, {
      password: TEST_PASSWORD, expected_version: disabled.version,
    })
    await empSession.page.reload()
    await empSession.page.getByTestId('task-completion-request').click()
    await expect(empSession.page.getByTestId('task-completion-pending')).toBeVisible()
  } finally {
    await empSession.context.close()
  }
})

test('creation requirement toggles change create behavior and failed defaults block submit', async ({ page }) => {
  await login(page)
  const before = await json(page, 'get', '/api/v1/settings/projects')
  try {
    await page.goto('/projects/settings')
    const endBox = page.locator('label').filter({ hasText: 'يشترط تاريخ الانتهاء' }).locator('input[type="checkbox"]')
    await expect(endBox).toBeChecked()
    const patched = page.waitForResponse((response) => (
      response.url().includes('/api/v1/settings/projects') && response.request().method() === 'PATCH'
    ))
    await page.locator('label').filter({ hasText: 'يشترط تاريخ الانتهاء' }).click()
    await patched
    await expect.poll(async () => (await json(page, 'get', '/api/v1/settings/projects')).require_end_date_on_create).toBe(false)
    const created = await page.request.post('/api/v1/projects', { data: { name: `PSC no-end ${Date.now()}` } })
    expect(created.status()).toBe(201)
    await page.goto('/projects/new')
    await page.route('**/api/v1/settings/projects/create-defaults', async (route) => {
      await route.abort('failed')
    })
    await page.reload()
    await expect(page.getByTestId('project-create-defaults-error')).toBeVisible()
    await expect(page.getByTestId('project-create-submit')).toBeDisabled()
    await page.unroute('**/api/v1/settings/projects/create-defaults')
    await page.getByTestId('project-create-retry').click()
    await expect(page.getByTestId('project-create-defaults-error')).toHaveCount(0)
  } finally {
    await json(page, 'patch', '/api/v1/settings/projects', {
      require_end_date_on_create: before.require_end_date_on_create,
      require_manager_on_create: before.require_manager_on_create,
    })
  }
})

test('digest pagination, partial visibility, null date, and app back', async ({ page, browser }) => {
  const fixturePath = process.env.E2E_PSC_FIXTURE
  expect(fixturePath, 'E2E_PSC_FIXTURE must be produced by verifier --mode e2e-fixtures').toBeTruthy()
  const fixture = JSON.parse(readFileSync(fixturePath!, 'utf8')) as {
    digest_notification_id: number
    manager_login: string
    manager_password: string
    project_b_id: number
    clear_task_id: number
    admin_id: number
    manager_id: number
    task_count: number
  }
  expect(fixture.task_count).toBeGreaterThanOrEqual(52)
  await login(page)
  const mgrSession = await loginContext(browser, fixture.manager_login, fixture.manager_password)
  try {
    const inbox = await json(mgrSession.page, 'get', '/api/v1/notifications?limit=50')
    const digest = inbox.items.find((item: { id: number; kind: string }) => item.id === fixture.digest_notification_id)
    expect(digest).toBeTruthy()
    expect(digest.kind).toBe('overdue_digest')
    expect(digest.overdue_count).toBeGreaterThanOrEqual(52)
    await mgrSession.page.goto(`/notification-digests/${digest.id}`)
    await expect(mgrSession.page.getByTestId('notification-digest')).toBeVisible()
    await expect(mgrSession.page.locator('[data-testid^="digest-task-"]')).toHaveCount(50)
    await expect(mgrSession.page.getByTestId('digest-load-more')).toBeVisible()
    await mgrSession.page.route('**/api/v1/notification-digests/**', async (route) => {
      if (route.request().url().includes('offset=50')) await route.abort('failed')
      else await route.continue()
    })
    await mgrSession.page.getByTestId('digest-load-more').click()
    await expect(mgrSession.page.getByTestId('digest-next-error')).toBeVisible()
    await expect(mgrSession.page.locator('[data-testid^="digest-task-"]')).toHaveCount(50)
    await mgrSession.page.unroute('**/api/v1/notification-digests/**')
    await mgrSession.page.getByTestId('digest-retry-page').click()
    await expect.poll(async () => mgrSession.page.locator('[data-testid^="digest-task-"]').count()).toBeGreaterThanOrEqual(52)
    await mgrSession.page.locator('[data-testid^="digest-task-"]').first().click()
    await expect(mgrSession.page).toHaveURL(/\/tasks\/\d+/)
    await mgrSession.page.getByRole('link', { name: 'العودة إلى المهام', exact: true }).click()
    await expect(mgrSession.page.getByTestId('notification-digest')).toBeVisible()
    await expect(mgrSession.page).toHaveURL(new RegExp(`/notification-digests/${digest.id}`))
    await json(page, 'patch', `/api/v1/projects/${fixture.project_b_id}`, {
      user_id: fixture.admin_id, privacy_visibility: 'followers',
    })
    await page.request.delete(`/api/v1/projects/${fixture.project_b_id}/followers/${fixture.manager_id}`)
    const revokedInbox = await json(mgrSession.page, 'get', '/api/v1/notifications?limit=50')
    const revoked = revokedInbox.items.find((item: { id: number }) => item.id === digest.id)
    expect(revoked).toBeTruthy()
    expect(revoked.overdue_count).toBeGreaterThan(0)
    expect(revoked.overdue_count).toBeLessThan(fixture.task_count)
    await mgrSession.page.goto(`/notification-digests/${digest.id}`)
    await mgrSession.page.reload()
    await expect(mgrSession.page.getByTestId('notification-digest')).toBeVisible()
    await expect.poll(async () => mgrSession.page.locator('[data-testid^="digest-task-"]').count()).toBe(
      Math.min(revoked.overdue_count, 50),
    )
    const cleared = await json(page, 'patch', `/api/v1/tasks/${fixture.clear_task_id}`, { date_deadline: null })
    expect(cleared.id).toBe(fixture.clear_task_id)
    const mixed = await mgrSession.page.request.get(`/api/v1/notification-digests/${digest.id}`)
    expect(mixed.status()).toBe(200)
  } finally {
    await mgrSession.context.close()
  }
})
