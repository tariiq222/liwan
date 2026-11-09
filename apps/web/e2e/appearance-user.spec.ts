import { expect, test } from '@playwright/test'
import { ACCEPTANCE_ORIGIN, openShell, signIn } from './support/realOdooSession'

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
  const signOut = page.waitForResponse(response => (
    response.url().endsWith('/api/auth/logout') && response.request().method() === 'POST'
  ))
  await page.getByRole('button', { name: 'تسجيل الخروج' }).click()
  expect((await signOut).status()).toBe(204)
  expect((await page.request.get('/api/v1/me')).status(), 'sign-out ends the server session').toBe(401)

  // The scratch run verified the server logout above. The current UI lands on /, so
  // this preference journey opens the login route before switching to the second user.
  await page.goto('/login')
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
