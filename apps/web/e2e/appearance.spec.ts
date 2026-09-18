import { expect, test, type Page } from '@playwright/test'

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill(process.env.E2E_ADMIN_LOGIN ?? 'admin')
  await page.getByLabel('كلمة المرور').fill(process.env.E2E_ADMIN_PASSWORD ?? 'admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  // Login lands on the first section the user may open (accessPolicy.firstAllowedPath).
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
}

async function primary(page: Page) {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim())
}

// Display mode and font size are a header menu (checkbox items behaving as
// two radio groups) saved per user through PATCH /api/v1/me/appearance.
async function choose(page: Page, label: string) {
  await page.getByTestId('appearance-menu').click()
  const item = page.getByRole('menuitemcheckbox', { name: label, exact: true })
  const response = page.waitForResponse(response => response.url().includes('/api/v1/me/appearance') && response.request().method() === 'PATCH')
  await item.click()
  expect((await response).status()).toBe(200)
}

async function expectChecked(page: Page, label: string) {
  await page.getByTestId('appearance-menu').click()
  await expect(page.getByRole('menuitemcheckbox', { name: label, exact: true })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
}

const MODE = { light: 'فاتح', cream: 'كريمي', dark: 'داكن' } as const
const FONT = { small: 'صغير', medium: 'وسط', large: 'كبير' } as const

test('appearance changes apply across routes and survive reload without changing branding', async ({ page }) => {
  await login(page)
  await page.request.patch('/api/v1/me/appearance', { data: { mode: 'light', font_size: 'small' } })
  await page.goto('/projects')
  const html = page.locator('html')
  const originalColor = await primary(page)
  await expectChecked(page, FONT.small)
  await expect(html).toHaveCSS('font-size', '14px')
  await expectChecked(page, MODE.light)

  await choose(page, MODE.cream)
  await expect(html).toHaveClass(/cream/)
  await expect(html).not.toHaveClass(/dark/)
  await expect(html).toHaveCSS('color-scheme', 'light')
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--background').trim())).toBe('#f6f1e7')
  expect(await primary(page)).toBe(originalColor)

  await choose(page, MODE.dark)
  await expect(html).toHaveClass(/dark/)
  await expect(html).not.toHaveClass(/cream/)
  await expect(html).toHaveCSS('color-scheme', 'dark')
  for (const [size, pixels] of [['medium', '16px'], ['large', '18px'], ['small', '14px']] as const) {
    await choose(page, FONT[size])
    await expect(html).toHaveCSS('font-size', pixels)
    await expect(html).toHaveClass(/dark/)
  }
  await choose(page, FONT.large)
  expect(await primary(page)).toBe(originalColor)
  await page.goto('/projects')
  await expect(html).toHaveClass(/dark/)
  await expect(html).toHaveCSS('font-size', '18px')
  await page.reload()
  await expect(html).toHaveClass(/dark/)
  await expect(html).toHaveCSS('font-size', '18px')
  expect(await primary(page)).toBe(originalColor)
  const me = await (await page.request.get('/api/v1/me')).json()
  expect(me.appearance).toEqual({ mode: 'dark', font_size: 'large' })
  await expectChecked(page, FONT.large)
  await choose(page, MODE.light)
  await expect(html).not.toHaveClass(/dark/)
  await expect(html).not.toHaveClass(/cream/)
  await expect(html).toHaveCSS('font-size', '18px')
})

test('the saved appearance belongs to the signed-in user, not the browser', async ({ page }) => {
  await login(page)
  await page.request.patch('/api/v1/me/appearance', { data: { mode: 'dark', font_size: 'large' } })
  await page.goto('/projects')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.locator('html')).toHaveCSS('font-size', '18px')
  // Another user on the same browser starts from their own (default) preference.
  await page.getByTestId('header-account').click().catch(() => page.locator('[data-slot="header-account"]').click())
  await page.getByRole('menuitem', { name: 'تسجيل الخروج' }).click()
  await expect(page).toHaveURL(/\/login/)
  const suffix = Date.now()
  const created = await page.request.post('/api/v1/admin/users', {
    data: { name: `Appearance ${suffix}`, login: `appearance-${suffix}@example.test`, password: 'Appearance-Initial-123!' },
  })
  test.skip(created.status() !== 201, 'user creation not available for this fixture')
  await page.getByLabel('اسم المستخدم').fill(`appearance-${suffix}@example.test`)
  await page.getByLabel('كلمة المرور').fill('Appearance-Initial-123!')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(page.locator('html')).toHaveCSS('font-size', '14px')
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
    await page.request.patch('/api/v1/me/appearance', { data: { mode: 'dark', font_size: 'medium' } })
    await page.goto('/projects', { waitUntil: 'commit' })
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.locator('html')).toHaveAttribute('data-font-size', 'medium')
    await expect(page.getByTestId('appearance-menu')).toBeDisabled()
  } finally {
    resume()
  }
  await expect(page.getByTestId('appearance-menu')).toBeEnabled()
  await choose(page, MODE.light)
  await expect(page.locator('html')).not.toHaveClass(/dark/)
})

test('saving organization color preserves personal mode and font preferences', async ({ page }) => {
  await login(page)
  await page.goto('/projects')
  await choose(page, MODE.dark)
  await choose(page, FONT.medium)
  await expect(page.getByTestId('branding-color')).toHaveCount(0)
  await page.goto('/settings/branding')
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
