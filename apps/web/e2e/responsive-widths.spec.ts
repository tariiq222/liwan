import { expect, test, type Page } from '@playwright/test'

// The page column is fluid, capped and centred, and no main route scrolls sideways at any common width, in RTL and LTR.
// Isolated mock stack (admin / admin).
const WIDTHS = [375, 768, 1280, 1440, 1920, 2560]
const ROUTES = ['/', '/apps', '/projects', '/tasks', '/crm', '/crm/opportunities', '/inbox', '/chat', '/hr', '/finance', '/documents', '/meetings', '/appointments', '/ai', '/settings', '/settings/company', '/settings/apps/projects', '/settings/apps/inbox']

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function switchLanguage(page: Page, dir: 'rtl' | 'ltr') {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/projects', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('account-menu')).toBeEnabled()
  await page.getByTestId('account-menu').click()
  await page.getByTestId('user-menu-language').getByRole('button', { name: dir === 'ltr' ? 'English' : 'العربية' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', dir)
}

// One test per direction and width, so a slow dev server fails one case instead of the whole sweep.
for (const dir of ['rtl', 'ltr'] as const) {
  for (const width of WIDTHS) {
    test(`no main route scrolls sideways at ${width}px (${dir})`, async ({ page }) => {
      test.setTimeout(180_000)
      await login(page)
      await switchLanguage(page, dir)
      try {
        await page.setViewportSize({ width, height: 900 })
        const failures: string[] = []
        for (const route of ROUTES) {
          await page.goto(route, { waitUntil: 'domcontentloaded' })
          await expect(page.getByTestId('shell-main')).toBeVisible()
          await expect(page.locator('html')).toHaveAttribute('dir', dir)
          await page.waitForTimeout(250)
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
          if (overflow > 0) failures.push(`${route}: +${overflow}px`)
        }
        expect(failures).toEqual([])
      } finally {
        // The mock keeps the language: leave it Arabic for the next test.
        if (dir === 'ltr') await switchLanguage(page, 'rtl')
      }
    })
  }
}

test('the page column is centred in the workspace at 1920px and capped at 1680px', async ({ page }) => {
  await login(page)
  await page.setViewportSize({ width: 1920, height: 900 })
  for (const route of ['/', '/projects', '/crm', '/settings/apps/projects']) {
    await page.goto(route, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('shell-main')).toBeVisible()
    const box = await page.evaluate(() => {
      const main = document.querySelector('[data-testid="shell-main"]')!.getBoundingClientRect()
      const workspace = document.querySelector('.liwan-shell-workspace')!.getBoundingClientRect()
      return { startGap: main.left - workspace.left, endGap: workspace.right - main.right, width: main.width }
    })
    expect(Math.abs(box.startGap - box.endGap), route).toBeLessThanOrEqual(2)
    expect(box.width, route).toBeLessThanOrEqual(1680)
  }
})
