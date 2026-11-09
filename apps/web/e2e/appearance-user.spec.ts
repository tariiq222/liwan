import { expect, test } from '@playwright/test'
import { ACCEPTANCE_ORIGIN, account, openShell, signIn } from './support/realOdooSession'

// Runs only on the isolated real-Odoo stack (deploy/ci/e2e-odoo.sh).
test.skip(process.env.E2E_REAL_ODOO !== '1', 'Explicit isolated real Odoo acceptance only')
test.beforeEach(async ({}, info) => { expect(new URL(String(info.project.use.baseURL)).origin).toBe(ACCEPTANCE_ORIGIN) })

// The appearance the first account applies: `useAppearance` also keeps it in a browser-level cookie, outside the
// session, so the next person to sign in on this browser starts from it until their own saved copy replaces it.
const APPLIED_APPEARANCE = { mode: 'dark', fontSize: 'large' } as const

test('the saved appearance belongs to the signed-in user, not the browser', async ({ page }) => {
  await signIn(page, 'admin')
  await page.request.patch('/api/v1/me/appearance', { data: { mode: 'dark', font_size: 'large' } })
  await page.goto('/projects')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.locator('html')).toHaveCSS('font-size', '18px')

  await page.goto('/account/settings')
  // Sign-out ends the session on the server and lands on the sign-in page. The 401 below proves the session really
  // ended; the URL and the visible form prove the app acted on it instead of keeping the previous identity.
  const signOut = page.waitForResponse(response => (
    response.url().endsWith('/api/auth/logout') && response.request().method() === 'POST'
  ))
  await page.getByRole('button', { name: 'تسجيل الخروج' }).click()
  expect((await signOut).status()).toBe(204)
  await expect(page).toHaveURL(/\/login(?:\?|$)/)
  await expect(page.getByLabel('اسم المستخدم'), 'the sign-in form is what sign-out leaves behind').toBeVisible()
  // The shell painted the outgoing account's name over the sign-in page while the loop ran; the login page shows
  // neither the name nor the login it just left.
  await expect(page.getByText('E2E Admin', { exact: false }), 'no stale identity is painted').toHaveCount(0)
  await expect(page.getByText(account('admin').login, { exact: false }), 'no stale login is painted').toHaveCount(0)
  expect((await page.request.get('/api/v1/me')).status(), 'sign-out ends the server session').toBe(401)

  await signIn(page, 'staff1')
  // Another user on the same browser starts from their own (default) preference. `signIn` empties the whole cookie
  // jar before it starts, so put the browser-level copy the first user left behind back: the second user's own saved
  // preference is what has to win over it.
  await page.context().addCookies([{
    name: 'liwan-appearance',
    value: encodeURIComponent(JSON.stringify(APPLIED_APPEARANCE)),
    url: ACCEPTANCE_ORIGIN,
  }])
  // Self-service settings is the section every signed-in identity holds, so it is where the second user's own
  // preference shows.
  await openShell(page, '/account/settings')
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(page.locator('html')).toHaveCSS('font-size', '14px')
})
