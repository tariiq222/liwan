import { test, expect } from '@playwright/test'
import { MeSchema } from '@nasq/contracts'

const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

async function login(page, password = ADMIN_PASSWORD) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill(ADMIN_LOGIN)
  await page.getByLabel('كلمة المرور').fill(password)
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
}

async function restorePassword(page, browser, temporaryPassword: string) {
  let restoreRes = await page.request.post('/api/v1/me/password', {
    data: { current: temporaryPassword, new: ADMIN_PASSWORD },
  })
  if (restoreRes.status() !== 200) {
    // A failed assertion may have left the browser context in a bad state;
    // obtain a fresh session before the final credential restoration attempt.
    const recovery = await browser.newContext({ baseURL: BASE_URL })
    try {
      const recoveryLogin = await recovery.request.post('/api/auth/login', {
        data: { login: ADMIN_LOGIN, password: temporaryPassword },
      })
      if (recoveryLogin.status() === 200) {
        restoreRes = await recovery.request.post('/api/v1/me/password', {
          data: { current: temporaryPassword, new: ADMIN_PASSWORD },
        })
      }
    } finally {
      await recovery.close()
    }
  }
  expect(restoreRes.status()).toBe(200)
  MeSchema.parse(await restoreRes.json())
}

test('admin changes a password, keeps the session, and can restore the original credential', async ({ page, browser }) => {
  await login(page)

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const temporaryPassword = `E2E-account-password-${suffix}`
  let changed = false

  try {
    await page.goto('/account')
    await expect(page.getByRole('heading', { name: 'الحساب' })).toBeVisible()

    // Failed credentials must clear every secret field just like success.
    await page.getByTestId('pw-current').fill(`${ADMIN_PASSWORD}-wrong`)
    await page.getByTestId('pw-new').fill(temporaryPassword)
    await page.getByTestId('pw-confirm').fill(temporaryPassword)
    const rejectedMutation = page.waitForResponse((response) => (
      response.url().includes('/api/v1/me/password') && response.request().method() === 'POST'
    ))
    await page.getByTestId('pw-submit').click()
    expect((await rejectedMutation).status()).toBe(422)
    await expect(page.getByTestId('pw-current')).toHaveValue('')
    await expect(page.getByTestId('pw-new')).toHaveValue('')
    await expect(page.getByTestId('pw-confirm')).toHaveValue('')

    await page.getByTestId('pw-current').fill(ADMIN_PASSWORD)
    await page.getByTestId('pw-new').fill(temporaryPassword)
    await page.getByTestId('pw-confirm').fill(temporaryPassword)
    const passwordMutation = page.waitForResponse((response) => (
      response.url().includes('/api/v1/me/password') && response.request().method() === 'POST'
    ))
    await page.getByTestId('pw-submit').click()
    const passwordMutationRes = await passwordMutation
    if (passwordMutationRes.status() === 200) changed = true
    await expect(page.getByRole('status').filter({ hasText: 'تم تغيير كلمة المرور بنجاح' })).toBeVisible()
    await expect(page.getByTestId('pw-current')).toHaveValue('')
    await expect(page.getByTestId('pw-new')).toHaveValue('')
    await expect(page.getByTestId('pw-confirm')).toHaveValue('')

    // The password endpoint must preserve the current authenticated session.
    await expect(page).toHaveURL(/\/account$/)
    const meRes = await page.request.get('/api/v1/me')
    expect(meRes.status()).toBe(200)
    MeSchema.parse(await meRes.json())

    const newContext = await browser.newContext({ baseURL: BASE_URL, locale: 'ar-SA' })
    try {
      const newLogin = await newContext.request.post('/api/auth/login', {
        data: { login: ADMIN_LOGIN, password: temporaryPassword },
      })
      expect(newLogin.status()).toBe(200)
    } finally {
      await newContext.close()
    }

    const oldContext = await browser.newContext({ baseURL: BASE_URL, locale: 'ar-SA' })
    try {
      const oldLogin = await oldContext.request.post('/api/auth/login', {
        data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD },
      })
      expect(oldLogin.status()).toBe(401)
    } finally {
      await oldContext.close()
    }
  } finally {
    if (changed) await restorePassword(page, browser, temporaryPassword)
  }
})
