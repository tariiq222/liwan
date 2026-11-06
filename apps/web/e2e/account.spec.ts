import { test, expect } from '@playwright/test'
import { MeSchema } from '@liwan/contracts'

// Needs a real Odoo: it signs in as a seeded account and changes its password, which the mock answers with 404. It is in no CI list until it has run on a
// scratch Odoo (see docs/testing.md, section 3).
test.skip(process.env.E2E_REAL_ODOO !== '1', 'Explicit isolated real Odoo acceptance only')

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
// The account tools/e2e_seed.py creates: an administrator cannot give a new account a password.
const ACCOUNT_LOGIN = 'e2e_staff2'
const FIXTURE_PASSWORD = process.env.E2E_USER_STAFF2_PASSWORD ?? 'liwan-e2e-staff2-2026'

async function login(page, loginName: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill(loginName)
  await page.getByLabel('كلمة المرور').fill(password)
  await page.getByRole('button', { name: 'دخول' }).click()
  // Login lands on the first section the user may open (accessPolicy.firstAllowedPath).
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
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
  const fixture = { loginName: ACCOUNT_LOGIN, suffix: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
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
