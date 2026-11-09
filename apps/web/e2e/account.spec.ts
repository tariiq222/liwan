import { test, expect, type Page } from '@playwright/test'
import { MeSchema } from '@liwan/contracts'
import { ACCEPTANCE_ORIGIN, account, openShell, signIn, type SeededUser } from './support/realOdooSession'

// Runs only on the isolated real-Odoo stack (deploy/ci/e2e-odoo.sh).
test.skip(process.env.E2E_REAL_ODOO !== '1', 'Explicit isolated real Odoo acceptance only')
test.beforeEach(async ({}, info) => { expect(new URL(String(info.project.use.baseURL)).origin).toBe(ACCEPTANCE_ORIGIN) })

/**
 * Puts the seeded credential back, unconditionally, whatever the journey above did.
 *
 * The signed-in browser session is the only context that can write it: a password step alone leaves a pre-session
 * that `/api/v1/me/password` answers 401 for, so a fresh context can never sign in to restore. When the change never
 * landed (`changed` false) the attempt is a no-op that answers 422 `wrong_password` and the fixture is already intact;
 * when it did land, anything but 200 leaves the fixture's password changed and fails the run.
 */
async function restoreSeededPassword(page: Page, fixture: SeededUser, temporaryPassword: string, changed: boolean) {
  let restored: { status: number, body: string }
  try {
    const response = await page.request.post('/api/v1/me/password', {
      data: { current: temporaryPassword, new: fixture.password },
    })
    restored = { status: response.status(), body: await response.text() }
  } catch (error) {
    restored = { status: 0, body: String(error) }
  }
  // A refusal only matters when the temporary password had actually landed; otherwise the fixture is untouched.
  if (restored.status !== 200) {
    if (changed) expect(restored.status, `restoring the seeded password failed: ${restored.body}`).toBe(200)
    return
  }
  MeSchema.parse(JSON.parse(restored.body))
}

test('employee changes a password, keeps the session, and can restore the original credential', async ({ browser }) => {
  const fixture = account('staff2')
  const temporaryPassword = `E2E-account-password-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const employeeContext = await browser.newContext({ baseURL: ACCEPTANCE_ORIGIN, locale: 'ar-SA' })
  const employeePage = await employeeContext.newPage()
  let changed = false

  try {
    await signIn(employeePage, 'staff2')
    await openShell(employeePage, '/account/settings')
    await expect(employeePage.getByRole('heading', { level: 1, name: 'إعدادات حسابي' })).toBeVisible()

    // Failed credentials must clear every secret field just like success.
    await employeePage.getByTestId('pw-current').fill(`${fixture.password}-wrong`)
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

    await employeePage.getByTestId('pw-current').fill(fixture.password)
    await employeePage.getByTestId('pw-new').fill(temporaryPassword)
    await employeePage.getByTestId('pw-confirm').fill(temporaryPassword)
    const passwordMutation = employeePage.waitForResponse((response) => (
      response.url().includes('/api/v1/me/password') && response.request().method() === 'POST'
    ))
    await employeePage.getByTestId('pw-submit').click()
    const passwordMutationRes = await passwordMutation
    changed = passwordMutationRes.status() === 200
    expect(passwordMutationRes.status(), await passwordMutationRes.text()).toBe(200)
    await expect(employeePage.getByRole('status').filter({ hasText: 'تم تغيير كلمة المرور بنجاح' })).toBeVisible()
    await expect(employeePage.getByTestId('pw-current')).toHaveValue('')
    await expect(employeePage.getByTestId('pw-new')).toHaveValue('')
    await expect(employeePage.getByTestId('pw-confirm')).toHaveValue('')

    // The password endpoint must preserve the current authenticated session.
    await expect(employeePage).toHaveURL(/\/account\/settings$/)
    const meRes = await employeePage.request.get('/api/v1/me')
    expect(meRes.status()).toBe(200)
    MeSchema.parse(await meRes.json())

    // A correct password alone never signs in: it answers the pending second step, a pre-session that carries no
    // identity. The credential it replaced is refused outright.
    const newContext = await browser.newContext({ baseURL: ACCEPTANCE_ORIGIN, locale: 'ar-SA' })
    try {
      const newLogin = await newContext.request.post('/api/auth/login', {
        data: { login: fixture.login, password: temporaryPassword },
      })
      expect(newLogin.status()).toBe(200)
      expect(await newLogin.json()).toEqual({ ok: false, mfa: 'code' })
    } finally {
      await newContext.close()
    }

    const oldContext = await browser.newContext({ baseURL: ACCEPTANCE_ORIGIN, locale: 'ar-SA' })
    try {
      const oldLogin = await oldContext.request.post('/api/auth/login', {
        data: { login: fixture.login, password: fixture.password },
      })
      expect(oldLogin.status()).toBe(401)
    } finally {
      await oldContext.close()
    }
  } finally {
    try {
      await restoreSeededPassword(employeePage, fixture, temporaryPassword, changed)
    } finally {
      await employeeContext.close()
    }
  }
})
