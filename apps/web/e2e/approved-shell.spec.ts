import { expect, test, type Page } from '@playwright/test'

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill(process.env.E2E_LOGIN ?? 'admin')
  await page.getByLabel('كلمة المرور').fill(process.env.E2E_PASSWORD ?? 'admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
}

test('approved shell connects its brand frame and only collapses the module rail', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await login(page)
  const rail = page.getByTestId('module-rail')
  const context = page.getByTestId('context-sidebar')
  const toggle = page.getByTestId('module-rail-toggle')
  await expect(page.locator('main h1')).toHaveCount(1)
  await expect(page.getByTestId('shell-header').locator('h1')).toHaveCount(0)
  await expect(rail).toHaveCSS('width', '64px')
  await expect(context).toHaveCSS('width', '244px')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  const headerColor = await page.getByTestId('shell-header').evaluate(el => getComputedStyle(el).backgroundColor)
  await expect(rail).toHaveCSS('background-color', headerColor)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(rail).toHaveCSS('width', '172px')
  await expect(context).toHaveCSS('width', '244px')
  await toggle.click()
  await expect(context).toBeVisible()
})

test('module context follows direct routes and refresh', async ({ page }) => {
  await login(page)
  await page.goto('/projects')
  await expect(page.getByTestId('context-sidebar').getByRole('link', { name: /قوالب/ })).toBeVisible()
  await page.goto('/tasks')
  await expect(page.getByTestId('context-sidebar').getByRole('link', { name: /قوالب/ })).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('context-sidebar')).toBeVisible()
  await expect(page.locator('h1')).toHaveCount(1)
})

for (const width of [390, 768, 1440]) {
  test(`approved shell stays usable at ${width}px with large type and all appearance modes`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await login(page)
    for (const mode of ['light', 'cream', 'dark']) {
      await page.goto('/settings/appearance')
      await page.getByTestId('appearance-font-large').check()
      await page.getByTestId(`appearance-mode-${mode}`).check()
      await expect(page.locator('h1')).toHaveCount(1)
      await expect(page.getByTestId('context-sidebar')).toBeVisible()
      await expect(page.getByRole('button', { name: 'بحث', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: /^حسابي/ })).toBeVisible()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
    }
  })
}
