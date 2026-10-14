import { expect, type Page } from '@playwright/test'

// Plan 6e shared helpers. The session comes from the mock login API; vendor and subscription data
// come from the stub control plane (commercial-mock-routes.mjs), switched on by p6e-e2e.sh.
const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'

export async function login(page: Page) {
  const response = await page.request.post('/api/auth/login', { data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD } })
  expect(response.status()).toBe(200)
}
export async function open(page: Page, path: string) {
  // The first visit to a page in a cold `nuxt dev` compiles it and may reload once; allow one retry and a longer wait.
  await page.goto(path).catch(() => page.goto(path))
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled({ timeout: 30_000 })
}
export const rows = (page: Page) => page.locator('tbody tr[data-shortcut-row]')
export const mobileRows = (page: Page) => page.locator('li[data-shortcut-row]')
export const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
/** The shell may draw its own h1 only through the page template; a page must never add a second one. */
export const expectNoSecondH1 = (page: Page) => expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
