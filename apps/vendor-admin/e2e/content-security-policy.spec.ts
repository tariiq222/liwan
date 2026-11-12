import { expect, test, type Page } from '@playwright/test'
import { ADMIN_PASSWORD, OWNER_EMAIL, TOTP_CODE } from './mock-settings.mjs'
import { hydrated } from './commercial-helpers'
import { resetMock } from './support'

// AUDIT-039: the production build serves a nonce-based policy and every page still hydrates under it.
test.beforeEach(async () => { await resetMock() })

/** Collects every CSP violation the page reports, from the DOM event and from the console. */
function watchViolations(page: Page): string[] {
  const violations: string[] = []
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text())
  })
  void page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(`Content Security Policy violation: ${event.violatedDirective} ${event.blockedURI}`)
    })
  })
  return violations
}

test('pages carry a script policy without unsafe-inline and a fresh nonce', async ({ page }) => {
  const first = await page.request.get('/login')
  const second = await page.request.get('/login')
  const policy = first.headers()['content-security-policy'] ?? ''
  const scriptSrc = policy.split(';').map(part => part.trim()).find(part => part.startsWith('script-src '))
  expect(scriptSrc).toMatch(/^script-src 'self' 'nonce-[A-Za-z0-9+/]{24}'$/)
  expect(policy).toContain("frame-ancestors 'none'")
  expect(second.headers()['content-security-policy']).not.toBe(policy)
  const nonce = /'nonce-([^']+)'/.exec(policy)![1]
  const html = await first.text()
  const scripts = html.match(/<script\b[^>]*>/g) ?? []
  expect(scripts.length).toBeGreaterThan(0)
  for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`)
})

test('sign-in and the overview run with no policy violation', async ({ page }) => {
  const violations = watchViolations(page)
  await page.goto('/login')
  await hydrated(page)
  await page.getByRole('button', { name: 'فقدت جهازك؟' }).click()
  await page.locator('#email').fill(OWNER_EMAIL)
  await page.locator('#password').fill(ADMIN_PASSWORD)
  await page.locator('#totp-code').fill(TOTP_CODE)
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).toHaveURL(/\/overview$/)
  await hydrated(page)
  expect(violations).toEqual([])
})
