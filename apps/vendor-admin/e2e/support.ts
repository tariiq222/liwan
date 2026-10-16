import { expect, type BrowserContext, type Page } from '@playwright/test'
import { ADMIN_PASSWORD, MOCK_PORT, TOTP_CODE } from './mock-settings.mjs'

const MOCK = `http://127.0.0.1:${MOCK_PORT}`

export async function mock<T = unknown>(path: string, method: 'GET' | 'POST' = 'POST', body?: object): Promise<T | undefined> {
  const response = await fetch(`${MOCK}${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined })
  if (!response.ok) throw new Error(`mock ${path} answered ${response.status}`)
  return response.status === 204 ? undefined : await response.json() as T
}

export const ageStepUp = () => mock('/__mock/age-step-up')
export const resetMock = () => mock('/__mock/reset')
export const mintInvitation = (roles?: string[]) => mock<{ token: string, email: string }>('/__mock/invitations', 'POST', { roles }).then(value => value!)
export const mockStats = () => mock<{ anonymous: number, numeric: number, rejected: number, lastClientIp: string | null, sessions: number }>('/__mock/stats', 'GET').then(value => value!)

/** A CTAP2 platform authenticator with resident keys and user verification, answering every prompt. */
export async function addVirtualAuthenticator(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  })
  return {
    /** While false the browser prompt stays open until the test lets it through. */
    answerPrompts: (enabled: boolean) => cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled }),
    remove: () => cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }),
  }
}

/** Opens an invitation link and waits for the passkey step; the page has removed the fragment by then. */
export async function openInvitation(page: Page, token: string) {
  await page.goto(`/enroll#${token}`)
  await expect(page.locator('#device-label')).toBeVisible()
}

/** From the passkey step to the recovery codes: passkey, authenticator code and password. Returns the codes shown. */
export async function completeEnrollment(page: Page, label = 'Work laptop'): Promise<string[]> {
  await page.locator('#device-label').fill(label)
  await page.getByRole('button', { name: 'إضافة مفتاح المرور' }).click()
  await expect(page.locator('[data-slot="totp-setup"] code')).toBeVisible()
  await page.locator('#new-password').fill(ADMIN_PASSWORD)
  await page.locator('#confirm-password').fill(ADMIN_PASSWORD)
  await page.locator('#totp-code').fill(TOTP_CODE)
  await page.getByRole('button', { name: 'إنهاء التفعيل' }).click()
  await expect(page.locator('[data-slot="recovery-codes"]')).toBeVisible()
  return (await page.locator('[data-slot="recovery-codes"] li').allTextContents()).map(code => code.trim())
}

/** Confirms the codes are saved and continues into the app. */
export async function leaveRecoveryCodes(page: Page) {
  await page.getByLabel('حفظت الرموز في مكان آمن').check()
  await page.getByRole('button', { name: 'متابعة إلى لوحة الإدارة' }).click()
  await expect(page).toHaveURL(/\/overview$/)
}

export const signOutRequest = (page: Page) =>
  page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(response => response.status))
