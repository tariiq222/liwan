import { expect, type Page } from '@playwright/test'

// Shared helpers for the vendor console specs. The session comes from the BFF's password + TOTP
// sign-in against the mock control service; the data comes from commercial-mock-routes.mjs.
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'owner@nasq.test'
export const RESTRICTED_EMAIL = process.env.E2E_RESTRICTED_EMAIL ?? 'support@nasq.test'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'correct-horse-battery'
const ADMIN_TOTP = process.env.E2E_ADMIN_TOTP ?? '123456'
const BASE_ORIGIN = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3133').origin

export async function login(page: Page, email = ADMIN_EMAIL) {
  const response = await page.request.post('/api/auth/fallback', {
    data: { email, password: ADMIN_PASSWORD, totp_code: ADMIN_TOTP },
    headers: { origin: BASE_ORIGIN },
  })
  expect(response.status()).toBe(200)
}
export async function open(page: Page, path: string) {
  // The first visit to a page in a cold `nuxt dev` compiles it and may reload once; allow one retry and a longer wait.
  await page.goto(path).catch(() => page.goto(path))
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 30_000 })
}
/**
 * A client-side navigation, so the browser (not the server render) fetches the page's data and route
 * interception applies. A navigation the route gate aborts resolves too; specs assert the outcome.
 */
export const navigateClient = (page: Page, path: string) =>
  page.evaluate(
    target => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } }).useNuxtApp().$router.push(target).catch(() => undefined),
    path,
  )
export const rows = (page: Page) => page.locator('tbody tr[data-shortcut-row]')
export const mobileRows = (page: Page) => page.locator('li[data-shortcut-row]')
export const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
/** The shell may draw its own h1 only through the page template; a page must never add a second one. */
export const expectNoSecondH1 = (page: Page) => expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
