import { test, expect } from '@playwright/test'
import { MeSchema } from '@liwan/contracts'

// Needs a real Odoo: it logs in as admin and writes data, which the mock answers with 404. It is in no CI list until it has run on a
// scratch Odoo (see docs/testing.md, section 3).
test.skip(process.env.E2E_REAL_ODOO !== '1', 'Explicit isolated real Odoo acceptance only')

const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const FIXTURE_PASSWORD = 'LiwanAccount-Initial-123!'

async function login(page, loginName = ADMIN_LOGIN, password = ADMIN_PASSWORD) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill(loginName)
  await page.getByLabel('كلمة المرور').fill(password)
  await page.getByRole('button', { name: 'دخول' }).click()
  // Login lands on the first section the user may open (accessPolicy.firstAllowedPath).
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
}

async function createPasswordFixture(page) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const loginName = `account-password-${suffix}@example.test`
  const meRes = await page.request.get('/api/v1/me')
  expect(meRes.status()).toBe(200)
  const me = MeSchema.parse(await meRes.json())
  const rolesRes = await page.request.get('/api/v1/admin/roles')
  expect(rolesRes.status()).toBe(200)
  const roles = await rolesRes.json()
  const employeeRole = roles.items.find((role: { key: string }) => role.key === 'employee')
  expect(employeeRole).toBeTruthy()
  const employeeRes = await page.request.post('/api/v1/hr/employees', {
    data: { name: `Account password ${suffix}`, work_email: loginName },
  })
  expect(employeeRes.status()).toBe(201)
  const employee = await employeeRes.json()
  const userRes = await page.request.post('/api/v1/admin/employee-accounts', {
    data: {
      employee_id: employee.id,
      password: FIXTURE_PASSWORD,
      assignments: [{ role_id: employeeRole.id, scope: { kind: 'company', id: me.company.id } }],
    },
  })
  expect(userRes.status()).toBe(201)
  return { loginName, suffix }
}

async function restorePassword(page, browser, loginName: string, temporaryPassword: string) {
  let restoreRes = await page.request.post('/api/v1/me/password', {
    data: { current: temporaryPassword, new: FIXTURE_PASSWORD },
  })
  if (restoreRes.status() !== 200) {
    // A failed assertion may have left the browser context in a bad state;
    // obtain a fresh session before the final credential restoration attempt.
    const recovery = await browser.newContext({ baseURL: BASE_URL })
    try {
      const recoveryLogin = await recovery.request.post('/api/auth/login', {
        data: { login: loginName, password: temporaryPassword },
      })
      if (recoveryLogin.status() === 200) {
        restoreRes = await recovery.request.post('/api/v1/me/password', {
          data: { current: temporaryPassword, new: FIXTURE_PASSWORD },
        })
      }
    } finally {
      await recovery.close()
    }
  }
  expect(restoreRes.status()).toBe(200)
  MeSchema.parse(await restoreRes.json())
}

test('employee changes a password, keeps the session, and can restore the original credential', async ({ page, browser }) => {
  await login(page)
  const fixture = await createPasswordFixture(page)
  const employeeContext = await browser.newContext({ baseURL: BASE_URL, locale: 'ar-SA' })
  const employeePage = await employeeContext.newPage()
  await login(employeePage, fixture.loginName, FIXTURE_PASSWORD)

  const temporaryPassword = `E2E-account-password-${fixture.suffix}`
  let changed = false

  try {
    await employeePage.goto('/account')
    await expect(employeePage.getByRole('heading', { name: 'الحساب' })).toBeVisible()

    // Failed credentials must clear every secret field just like success.
    await employeePage.getByTestId('pw-current').fill(`${FIXTURE_PASSWORD}-wrong`)
    await employeePage.getByTestId('pw-new').fill(temporaryPassword)
    await employeePage.getByTestId('pw-confirm').fill(temporaryPassword)
    const rejectedMutation = employeePage.waitForResponse((response) => (
      response.url().includes('/api/v1/me/password') && response.request().method() === 'POST'
    ))
    await employeePage.getByTestId('pw-submit').click()
    expect((await rejectedMutation).status()).toBe(422)
    await expect(employeePage.getByTestId('pw-current')).toHaveValue('')
    await expect(employeePage.getByTestId('pw-new')).toHaveValue('')
    await expect(employeePage.getByTestId('pw-confirm')).toHaveValue('')

    await employeePage.getByTestId('pw-current').fill(FIXTURE_PASSWORD)
    await employeePage.getByTestId('pw-new').fill(temporaryPassword)
    await employeePage.getByTestId('pw-confirm').fill(temporaryPassword)
    const passwordMutation = employeePage.waitForResponse((response) => (
      response.url().includes('/api/v1/me/password') && response.request().method() === 'POST'
    ))
    await employeePage.getByTestId('pw-submit').click()
    const passwordMutationRes = await passwordMutation
    if (passwordMutationRes.status() === 200) changed = true
    await expect(employeePage.getByRole('status').filter({ hasText: 'تم تغيير كلمة المرور بنجاح' })).toBeVisible()
    await expect(employeePage.getByTestId('pw-current')).toHaveValue('')
    await expect(employeePage.getByTestId('pw-new')).toHaveValue('')
    await expect(employeePage.getByTestId('pw-confirm')).toHaveValue('')

    // The password endpoint must preserve the current authenticated session.
    await expect(employeePage).toHaveURL(/\/account$/)
    const meRes = await employeePage.request.get('/api/v1/me')
    expect(meRes.status()).toBe(200)
    MeSchema.parse(await meRes.json())

    const newContext = await browser.newContext({ baseURL: BASE_URL, locale: 'ar-SA' })
    try {
      const newLogin = await newContext.request.post('/api/auth/login', {
        data: { login: fixture.loginName, password: temporaryPassword },
      })
      expect(newLogin.status()).toBe(200)
    } finally {
      await newContext.close()
    }

    const oldContext = await browser.newContext({ baseURL: BASE_URL, locale: 'ar-SA' })
    try {
      const oldLogin = await oldContext.request.post('/api/auth/login', {
        data: { login: fixture.loginName, password: FIXTURE_PASSWORD },
      })
      expect(oldLogin.status()).toBe(401)
    } finally {
      await oldContext.close()
    }
  } finally {
    try {
      if (changed) await restorePassword(employeePage, browser, fixture.loginName, temporaryPassword)
    } finally {
      await employeeContext.close()
    }
  }
})
