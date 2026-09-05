import { test, expect, type Browser, type BrowserContext, type Locator, type Page, type Response } from '@playwright/test'
import { HrEmployeeSchema, HrEmployeeListSchema, MeSchema } from '@nasq/contracts'

const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

async function login(page: Page, login: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill(login)
  await page.getByLabel('كلمة المرور').fill(password)
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).toHaveURL(/\/tasks$/, { timeout: 15_000 })
}

async function employeeContext(browser: Browser, loginName: string, password: string): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: BASE_URL, locale: 'ar-SA' })
  const response = await context.request.post('/api/auth/login', { data: { login: loginName, password } })
  expect(response.status()).toBe(200)
  return context
}

async function expectResponse(responsePromise: Promise<Response>, status: number) {
  const response = await responsePromise
  expect(response.status()).toBe(status)
  await response.finished()
  return response
}

async function managementDialog(page: Page, name: string) {
  const row = page.getByRole('row', { name: new RegExp(name) })
  await expect(row).toBeVisible()
  await row.getByTestId('hr-employee-manage').click()
  const dialog = page.getByRole('dialog', { name, exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

async function selectRole(page: Page, dialog: Locator, roleName: 'موظف' | 'مدير نظام') {
  await dialog.getByRole('combobox').click()
  await page.getByRole('option', { name: roleName, exact: true }).click()
}

test('admin manages employee access while sessions, archive views, and department documents stay coherent', async ({ page, browser }) => {
  test.setTimeout(90_000)
  await login(page, ADMIN_LOGIN, ADMIN_PASSWORD)

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const name = `E2E access ${suffix}`
  const email = `e2e-access-${suffix}@example.test`
  const firstPassword = `E2E-access-first-${suffix}`
  const nextPassword = `E2E-access-next-${suffix}`
  const departmentName = `E2E access docs ${suffix}`
  const documentName = `E2E access document ${suffix}`

  const departmentRes = await page.request.post('/api/v1/hr/departments', { data: { name: departmentName } })
  expect(departmentRes.status()).toBe(201)
  const department = await departmentRes.json()
  const documentRes = await page.request.post('/api/v1/hr/documents', {
    data: { name: documentName, body: 'Access lifecycle document', department_id: department.id },
  })
  expect(documentRes.status()).toBe(201)

  await page.goto('/hr')
  await page.getByRole('button', { name: 'موظف جديد' }).click()
  const createDialog = page.getByRole('dialog', { name: 'موظف جديد', exact: true })
  await createDialog.getByLabel('الاسم').fill(name)
  await createDialog.getByLabel('البريد الوظيفي').fill(email)
  const createEmployeeResponse = page.waitForResponse((response) => (
    response.url().includes('/api/v1/hr/employees') && response.request().method() === 'POST'
  ))
  await createDialog.getByRole('button', { name: 'حفظ' }).click()
  await expectResponse(createEmployeeResponse, 201)

  // Creation opens the same read-only card available to ordinary employees.
  const card = page.getByRole('dialog', { name: 'بطاقة الموظف', exact: true })
  await expect(card.getByText(name, { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')

  const dialog = await managementDialog(page, name)
  await dialog.getByRole('tab', { name: 'الوصول' }).click()
  await dialog.getByRole('button', { name: 'منح الوصول' }).click()
  const grantDialog = page.getByRole('dialog').last()
  await expect(grantDialog.getByRole('heading', { name: 'كلمة المرور' })).toBeVisible()
  await grantDialog.getByLabel('كلمة المرور').fill(firstPassword)
  const grantResponse = page.waitForResponse((response) => (
    response.url().endsWith('/access') && response.request().method() === 'POST'
  ))
  await grantDialog.getByRole('button', { name: 'حفظ' }).click()
  const granted = HrEmployeeSchema.parse(await (await expectResponse(grantResponse, 200)).json())
  expect(granted.access?.active).toBe(true)
  const linkedUserId = granted.access!.user_id
  await expect(dialog.getByText('موظف', { exact: true }).first()).toBeVisible()

  const employeeSession = await employeeContext(browser, email, firstPassword)
  try {
    const firstMe = MeSchema.parse(await (await employeeSession.request.get('/api/v1/me')).json())
    expect(firstMe.id).toBe(linkedUserId)
    const employeePage = await employeeSession.newPage()
    await employeePage.goto('/hr')
    await expect(employeePage.getByRole('heading', { name: 'الأشخاص' })).toBeVisible()
    await expect(employeePage.getByRole('button', { name: 'موظف جديد' })).toHaveCount(0)
    await expect(employeePage.getByTestId('hr-employee-manage')).toHaveCount(0)
    await expect(employeePage.getByRole('button', { name: 'عرض المؤرشفين' })).toHaveCount(0)

    await selectRole(page, dialog, 'مدير نظام')
    const promoteResponse = page.waitForResponse((response) => (
      response.url().endsWith('/access') && response.request().method() === 'PATCH'
    ))
    await dialog.getByRole('button', { name: 'حفظ الدور' }).click()
    await expectResponse(promoteResponse, 200)
    expect((await employeeSession.request.get('/api/v1/admin/branding')).status()).toBe(200)

    await selectRole(page, dialog, 'موظف')
    const demoteResponse = page.waitForResponse((response) => (
      response.url().endsWith('/access') && response.request().method() === 'PATCH'
    ))
    await dialog.getByRole('button', { name: 'حفظ الدور' }).click()
    await expectResponse(demoteResponse, 200)
    expect((await employeeSession.request.get('/api/v1/admin/branding')).status()).toBe(403)

    await dialog.getByRole('button', { name: 'تغيير كلمة المرور' }).click()
    const resetDialog = page.getByRole('dialog').last()
    await expect(resetDialog.getByRole('heading', { name: 'كلمة المرور' })).toBeVisible()
    await resetDialog.getByLabel('كلمة المرور').fill(nextPassword)
    const resetResponse = page.waitForResponse((response) => (
      response.url().endsWith('/access') && response.request().method() === 'PATCH'
    ))
    await resetDialog.getByRole('button', { name: 'حفظ' }).click()
    await expectResponse(resetResponse, 200)

    expect((await employeeSession.request.get('/api/v1/me')).status()).toBe(403)
    await employeePage.goto('/hr')
    await expect(employeePage).toHaveURL(/\/login(?:\?|$)/)
  } finally {
    await employeeSession.close()
  }

  const resetSession = await employeeContext(browser, email, nextPassword)
  try {
    const resetMe = MeSchema.parse(await (await resetSession.request.get('/api/v1/me')).json())
    expect(resetMe.id).toBe(linkedUserId)
    const resetPage = await resetSession.newPage()
    await resetPage.goto('/hr')
    await expect(resetPage.getByRole('heading', { name: 'الأشخاص' })).toBeVisible()

    await dialog.getByRole('button', { name: 'إلغاء الوصول' }).click()
    const revokeDialog = page.getByRole('dialog').last()
    await expect(revokeDialog.getByText('هل تريد إلغاء وصول حساب هذا الموظف؟')).toBeVisible()
    const revokeResponse = page.waitForResponse((response) => (
      response.url().endsWith('/access') && response.request().method() === 'DELETE'
    ))
    await revokeDialog.getByRole('button', { name: 'إلغاء الوصول' }).click()
    const revoked = HrEmployeeSchema.parse(await (await expectResponse(revokeResponse, 200)).json())
    expect(revoked.id).toBe(granted.id)
    expect(revoked.access).toMatchObject({ user_id: linkedUserId, active: false })
    await expect.poll(async () => {
      const response = await resetSession.request.get('/api/v1/me')
      if (response.status() === 200) {
        expect(MeSchema.parse(await response.json()).id).toBe(linkedUserId)
      }
      return response.status()
    }).toBe(403)
    await resetPage.goto('/hr')
    await expect(resetPage).toHaveURL(/\/login(?:\?|$)/)
  } finally {
    await resetSession.close()
  }

  await expect(dialog.getByRole('button', { name: 'منح الوصول' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()

  const activeRow = page.getByRole('row', { name: new RegExp(name) })
  await activeRow.getByTestId('hr-employee-archive-row').click()
  const archiveDialog = page.getByRole('dialog').last()
  await expect(archiveDialog.getByText('هل تريد تغيير حالة نشاط هذا الموظف؟')).toBeVisible()
  const archiveResponse = page.waitForResponse((response) => (
    response.url().endsWith('/archive') && response.request().method() === 'POST'
  ))
  await archiveDialog.getByRole('button', { name: 'أرشفة' }).click()
  await expectResponse(archiveResponse, 200)
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()
  await expect(activeRow).toHaveCount(0)

  await page.getByRole('button', { name: 'عرض المؤرشفين' }).click()
  const archivedRow = page.getByRole('row', { name: new RegExp(name) })
  await expect(archivedRow).toBeVisible()
  await archivedRow.getByTestId('hr-employee-archive-row').click()
  const unarchiveDialog = page.getByRole('dialog').last()
  await expect(unarchiveDialog.getByText('هل تريد تغيير حالة نشاط هذا الموظف؟')).toBeVisible()
  const unarchiveResponse = page.waitForResponse((response) => (
    response.url().endsWith('/unarchive') && response.request().method() === 'POST'
  ))
  await unarchiveDialog.getByRole('button', { name: 'استعادة' }).click()
  await expectResponse(unarchiveResponse, 200)
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()
  await expect(archivedRow).toHaveCount(0)
  await page.getByRole('button', { name: 'عرض النشطين' }).click()
  await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible()

  // The same page still exposes department-backed documents after every user
  // and session mutation above.
  await page.getByRole('tab', { name: 'الأقسام' }).click()
  await page.getByTestId('hr-department-table').getByRole('button', { name: new RegExp(departmentName) }).click()
  await expect(page.getByRole('heading', { name: 'المستندات' })).toBeVisible()
  await expect(page.getByRole('row', { name: new RegExp(documentName) })).toBeVisible()

  const employeeRes = await page.request.get(`/api/v1/hr/employees?q=${encodeURIComponent(name)}`)
  const employee = HrEmployeeListSchema.parse(await employeeRes.json()).items.find((item) => item.name === name)
  expect(employee).toBeDefined()
  HrEmployeeSchema.parse(employee)
  await expect(page.getByTestId('hr-department-table')).toBeVisible()
})
