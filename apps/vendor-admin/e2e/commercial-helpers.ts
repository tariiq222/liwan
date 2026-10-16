import { expect, type Page } from '@playwright/test'

import { resetMock } from './support'
import { ADMIN_PASSWORD, DEV_PORT, OWNER_EMAIL, PROD_PORT, SUPPORT_EMAIL, TOTP_CODE } from './mock-settings.mjs'

// Shared helpers for the vendor console specs. The session comes from the BFF's password + TOTP
// sign-in against the mock control service; the data comes from commercial-mock-routes.mjs.
export const RESTRICTED_EMAIL = SUPPORT_EMAIL
const BASE_ORIGIN = `http://localhost:${process.env.E2E_TARGET === 'dev' ? DEV_PORT : PROD_PORT}`

type NuxtAppHandle = { isHydrating: boolean, $router: { push: (to: string) => Promise<unknown> }, $i18n: { setLocale: (locale: string) => Promise<void> } }

/** Signs in through the BFF on a freshly reset mock (an earlier spec may have left it locked or unavailable). */
export async function login(page: Page, email = OWNER_EMAIL) {
  await resetMock()
  const response = await page.request.post('/api/auth/fallback', {
    data: { email, password: ADMIN_PASSWORD, totp_code: TOTP_CODE },
    headers: { origin: BASE_ORIGIN },
  })
  expect(response.status()).toBe(200)
}
export async function open(page: Page, path: string) {
  // The first visit to a page in a cold `nuxt dev` compiles it and may reload once; allow one retry and a longer wait.
  await page.goto(path).catch(() => page.goto(path))
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 30_000 })
}
/** Waits until the client has taken over the server render, so history navigation reaches the router. */
export const hydrated = (page: Page) =>
  page.waitForFunction(() => {
    const app = (window as unknown as { useNuxtApp?: () => NuxtAppHandle }).useNuxtApp?.()
    return app?.isHydrating === false && Boolean(app.$router)
  })
/**
 * A client-side navigation, so the browser (not the server render) fetches the page's data and route
 * interception applies. A navigation the route gate aborts resolves too; specs assert the outcome.
 */
export const navigateClient = async (page: Page, path: string) => {
  await hydrated(page)
  return page.evaluate((target) => {
    const app = (window as unknown as { useNuxtApp: () => NuxtAppHandle }).useNuxtApp()
    return app.$router.push(target).catch(() => undefined)
  }, path)
}
/** Changes the interface language in the running app, then optionally navigates client-side. */
export const switchLocale = async (page: Page, locale: string, path?: string) => {
  await hydrated(page)
  return page.evaluate(async ({ target, destination }) => {
    const app = (window as unknown as { useNuxtApp: () => NuxtAppHandle }).useNuxtApp()
    await app.$i18n.setLocale(target)
    if (destination) await app.$router.push(destination)
  }, { target: locale, destination: path })
}
export const rows = (page: Page) => page.locator('tbody tr[data-shortcut-row]')
export const mobileRows = (page: Page) => page.locator('li[data-shortcut-row]')
export const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
/** The shell may draw its own h1 only through the page template; a page must never add a second one. */
export const expectNoSecondH1 = (page: Page) => expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
