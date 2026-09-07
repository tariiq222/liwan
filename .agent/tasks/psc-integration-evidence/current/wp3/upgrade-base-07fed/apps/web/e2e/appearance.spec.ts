import { expect, test, type Page } from '@playwright/test'

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill(process.env.E2E_ADMIN_LOGIN ?? 'admin')
  await page.getByLabel('كلمة المرور').fill(process.env.E2E_ADMIN_PASSWORD ?? 'admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).toHaveURL(/\/tasks$/)
}

async function primary(page: Page) {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim())
}

test('appearance changes apply across routes and survive reload without changing branding', async ({ page }) => {
  await login(page)
  await page.goto('/settings/appearance')
  const html = page.locator('html')
  const originalColor = await primary(page)
  await expect(page.getByTestId('appearance-font-small')).toBeChecked()
  await expect(html).toHaveCSS('font-size', '14px')
  await expect(page.getByTestId('appearance-mode-light')).toBeChecked()

  await page.getByTestId('appearance-mode-dark').check()
  await expect(html).toHaveClass(/dark/)
  await expect(html).toHaveCSS('color-scheme', 'dark')
  for (const [size, pixels] of [['medium', '16px'], ['large', '18px'], ['small', '14px']] as const) {
    await page.getByTestId(`appearance-font-${size}`).check()
    await expect(html).toHaveCSS('font-size', pixels)
    await expect(html).toHaveClass(/dark/)
  }
  await page.getByTestId('appearance-font-large').check()
  expect(await primary(page)).toBe(originalColor)
  await page.goto('/projects')
  await expect(html).toHaveClass(/dark/)
  await expect(html).toHaveCSS('font-size', '18px')
  await page.reload()
  await expect(html).toHaveClass(/dark/)
  await expect(html).toHaveCSS('font-size', '18px')
  expect(await primary(page)).toBe(originalColor)
  await page.goto('/settings/appearance')
  await expect(page.getByTestId('appearance-font-large')).toBeChecked()
  await page.getByTestId('appearance-mode-light').check()
  await expect(html).not.toHaveClass(/dark/)
  await expect(html).toHaveCSS('font-size', '18px')
})

test('saved appearance is present before hydration and controls wait for hydration', async ({ page, context }) => {
  await login(page)
  await context.addCookies([{
    name: 'nasq-appearance', value: encodeURIComponent(JSON.stringify({ mode: 'dark', fontSize: 'medium' })),
    url: new URL(page.url()).origin,
  }])
  let resume!: () => void
  const gate = new Promise<void>(resolve => { resume = resolve })
  await page.route('**/_nuxt/**', async (route) => {
    if (route.request().resourceType() === 'script') await gate
    await route.continue()
  })
  try {
    await page.goto('/settings/appearance', { waitUntil: 'commit' })
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.locator('html')).toHaveAttribute('data-font-size', 'medium')
    await expect(page.getByTestId('appearance-mode-light')).toBeDisabled()
  } finally {
    resume()
  }
  await expect(page.getByTestId('appearance-mode-light')).toBeEnabled()
  await page.getByTestId('appearance-mode-light').check()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
})

test('saving organization color preserves personal mode and font preferences', async ({ page }) => {
  await login(page)
  await page.goto('/settings/appearance')
  await page.getByTestId('appearance-mode-dark').check()
  await page.getByTestId('appearance-font-medium').check()
  await page.getByTestId('settings-branding-tab').click()
  const color = page.getByTestId('branding-color')
  await expect(color).toBeVisible()
  const savedColor = await color.inputValue()
  async function save(value: string) {
    await color.fill(value)
    const response = page.waitForResponse(response => response.url().includes('/api/v1/admin/branding') && response.request().method() === 'PATCH')
    await page.getByTestId('branding-submit').click()
    expect((await response).status()).toBe(200)
  }
  try {
    await save('#0f766e')
    await page.reload()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.locator('html')).toHaveCSS('font-size', '16px')
    expect(await primary(page)).toBe('#0f766e')
  } finally {
    await save(savedColor)
  }
})
