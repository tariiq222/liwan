import { test, expect } from '@playwright/test'

// The documents library at the supported locales, themes and widths (isolated mock stack). Writes, access grants and
// file limits are covered by the liwan_documents addon tests; the document form pages by tasmim6-hr-forms.
test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Isolated synthetic API only')

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'liwan-context-sidebar', value: 'open', url: baseURL! }])
  const response = await page.request.post('/api/auth/login', { data: { login: process.env.E2E_ADMIN_LOGIN ?? 'admin', password: process.env.E2E_ADMIN_PASSWORD ?? 'admin' } })
  expect(response.ok()).toBe(true)
})

async function open(page: import('@playwright/test').Page, url: string) {
  await page.goto(url)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
}

for (const locale of ['ar', 'en']) for (const mode of ['light', 'dark']) for (const width of [390, 768, 1440]) {
  test(`library ${locale} ${mode} ${width} has one heading and no document overflow`, async ({ page }, testInfo) => {
    expect((await page.request.patch('/api/v1/me/appearance', { data: { mode } })).status()).toBe(200)
    await page.setViewportSize({ width, height: 900 })
    await open(page, '/documents')
    await page.evaluate(async language => { await (window as any).useNuxtApp().$i18n.setLocale(language) }, locale)
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
    await expect.poll(() => page.locator('html').evaluate(element => element.classList.contains('dark'))).toBe(mode === 'dark')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (width >= 768) await expect.poll(() => page.evaluate(() => {
      const main = document.querySelector('[data-testid="shell-main"]')!.getBoundingClientRect()
      const sidebar = document.querySelector('[data-testid="application-navigation"]')!.getBoundingClientRect()
      return document.documentElement.dir === 'rtl' ? main.right <= sidebar.left : main.left >= sidebar.right
    })).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`documents-library-${locale}-${mode}-${width}.png`), fullPage: true, animations: 'disabled' })
  })
}
