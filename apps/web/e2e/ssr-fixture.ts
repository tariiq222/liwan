import { expect, test as base, type BrowserContext, type Page } from '@playwright/test'

type SessionCookie = Awaited<ReturnType<BrowserContext['cookies']>>[number]
const scoped = new Map<Page, SessionCookie>()

// Use the normal session cookie, which survives the server-rendered BFF hop.
// No production header/cookie forwarding or application behavior is changed.
export async function setSsrFixture(page: Page, fixture: unknown) {
  const current = scoped.get(page)
  if (current) await page.context().addCookies([current])
  else if (!(await page.context().cookies()).some(cookie => cookie.name === 'session_id')) {
    const login = await page.request.post('/api/auth/login', { data: {
      login: process.env.E2E_ADMIN_LOGIN ?? 'admin', password: process.env.E2E_ADMIN_PASSWORD ?? 'admin',
    } })
    expect(login.status()).toBe(200)
  }
  const response = await page.request.put('/api/v1/__mock/ssr-fixture', { data: fixture })
  expect(response.status()).toBe(200)
  const cookie = (await page.context().cookies()).find(cookie => cookie.name === 'session_id')!
  scoped.set(page, cookie)
  if (current) return
  // Some journey helpers log in again after installing the fake. Login replaces
  // the cookie, so restore this context's fixture before its next SSR document.
  await page.route('**/*', async route => {
    if (!route.request().isNavigationRequest() || route.request().frame() !== page.mainFrame()) return route.fallback()
    const session = scoped.get(page)
    if (!session) return route.fallback()
    await page.context().addCookies([session])
    const cookies = await page.context().cookies(route.request().url())
    await route.fallback({ headers: { ...route.request().headers(), cookie: cookies.map(item => `${item.name}=${item.value}`).join('; ') } })
  })
}

// Automatic fixture teardown runs for every test using this test type, even
// when Playwright reuses the cached helper module across multiple spec files.
export const test = base.extend<{ ssrFixtureCleanup: void }>({
  ssrFixtureCleanup: [async ({ page }, use) => {
    await use()
    const cookie = scoped.get(page)
    if (!cookie) return
    await page.context().addCookies([cookie])
    const response = await page.request.delete('/api/v1/__mock/ssr-fixture')
    scoped.delete(page)
    expect(response.status()).toBe(200)
  }, { auto: true }],
})
