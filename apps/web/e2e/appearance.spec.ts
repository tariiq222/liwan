import { expect, test, type Page, type Route } from '@playwright/test'

async function login(page: Page) {
  // The context menu starts folded; these checks read the pinned menu.
  await page.context().addCookies([{ name: 'liwan-context-sidebar', value: 'open', url: new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3000').origin }])
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill(process.env.E2E_ADMIN_LOGIN ?? 'admin')
  await page.getByLabel('كلمة المرور').fill(process.env.E2E_ADMIN_PASSWORD ?? 'admin')
  const authenticated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  expect((await authenticated).status()).toBe(200)
  // Login lands on the first section the user may open (accessPolicy.firstAllowedPath).
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
}

async function primary(page: Page) {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim())
}

// Display mode and font size live in Self-service account settings, saved per user.
async function choose(page: Page, label: string) {
  await page.goto('/account/settings')
  const item = page.getByRole('radio', { name: label, exact: true })
  await expect(item).toBeVisible()
  // Selecting the already active value is intentionally a no-op, not a write.
  if (await item.getAttribute('aria-checked') === 'true') {
    return
  }
  const response = page.waitForResponse(response => response.url().includes('/api/v1/me/appearance') && response.request().method() === 'PATCH')
  await item.click()
  expect((await response).status()).toBe(200)
}

async function expectChecked(page: Page, label: string) {
  await page.goto('/account/settings')
  await expect(page.getByRole('radio', { name: label, exact: true })).toHaveAttribute('aria-checked', 'true')
}

const MODE = { light: 'فاتح', dark: 'داكن' } as const
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

  await choose(page, MODE.dark)
  await expect(html).toHaveClass(/dark/)
  await expect(html).toHaveCSS('color-scheme', 'dark')
  for (const [size, pixels] of [['medium', '16px'], ['large', '18px'], ['small', '14px']] as const) {
    await choose(page, FONT[size])
    await expect(html).toHaveCSS('font-size', pixels)
    await expect(html).toHaveClass(/dark/)
  }
  await choose(page, FONT.large)
  // The dark theme has its own primary tone; it must stay the same across routes and reloads, and the light one must come back.
  const darkColor = await primary(page)
  expect(darkColor).not.toBe('')
  await page.goto('/projects')
  await expect(html).toHaveClass(/dark/)
  await expect(html).toHaveCSS('font-size', '18px')
  await page.reload()
  await expect(html).toHaveClass(/dark/)
  await expect(html).toHaveCSS('font-size', '18px')
  expect(await primary(page)).toBe(darkColor)
  const me = await (await page.request.get('/api/v1/me')).json()
  expect(me.appearance).toEqual({ mode: 'dark', font_size: 'large' })
  await expectChecked(page, FONT.large)
  await choose(page, MODE.light)
  await expect(html).not.toHaveClass(/dark/)
  await expect(html).toHaveCSS('font-size', '18px')
  expect(await primary(page)).toBe(originalColor)
})

test('saved appearance is present before hydration and controls wait for hydration', async ({ page, context, baseURL }) => {
  // Authentication is a precondition here; the login form has its own acceptance tests.
  expect((await page.request.post('/api/auth/login', { data: { login: process.env.E2E_ADMIN_LOGIN ?? 'admin', password: process.env.E2E_ADMIN_PASSWORD ?? 'admin' } })).status()).toBe(200)
  expect(baseURL).toBeDefined()
  await context.addCookies([{
    name: 'liwan-appearance', value: encodeURIComponent(JSON.stringify({ mode: 'dark', fontSize: 'medium' })),
    url: new URL(baseURL!).origin,
  }])
  let resume!: () => void
  const gate = new Promise<void>(resolve => { resume = resolve })
  let released = false
  const heldScripts: Promise<void>[] = []
  const holdScripts = (route: Route) => {
    const held = !released && route.request().resourceType() === 'script'
    const handled = (async () => {
      if (held) await gate
      await route.continue()
    })()
    if (held) heldScripts.push(handled)
    return handled
  }
  await page.route('**/_nuxt/**', holdScripts)
  try {
    expect((await page.request.patch('/api/v1/me/appearance', { data: { mode: 'dark', font_size: 'medium' } })).status()).toBe(200)
    await page.goto('/projects', { waitUntil: 'commit' })
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.locator('html')).toHaveAttribute('data-font-size', 'medium')
    await expect(page.getByTestId('account-menu')).toBeDisabled()
  } finally {
    released = true
    resume()
    // Finish held routes before unroute, which can otherwise handle them twice.
    await Promise.all(heldScripts)
    // The gate owns only the initial scripts. Removing it also restores the
    // browser cache for the remaining dev-module graph after release.
    await page.unroute('**/_nuxt/**', holdScripts)
  }
  await expect(page.getByTestId('account-menu')).toBeEnabled()
  await choose(page, MODE.light)
  await expect(page.locator('html')).not.toHaveClass(/dark/)
})

test('saving organization color preserves personal mode and font preferences', async ({ page }) => {
  await login(page)
  await page.goto('/projects')
  await choose(page, MODE.dark)
  await choose(page, FONT.medium)
  await expect(page.getByTestId('branding-color')).toHaveCount(0)
  await page.goto('/settings/company#branding')
  const color = page.getByTestId('branding-color')
  await expect(color).toBeVisible()
  const savedColor = await color.inputValue()
  async function save(value: string) {
    await color.fill(value)
    const response = page.waitForResponse(response => response.url().includes('/api/v1/admin/branding') && response.request().method() === 'PATCH')
    await page.getByTestId('branding-form').getByRole('button', { name: 'حفظ التغييرات', exact: true }).click()
    expect((await response).status()).toBe(200)
  }
  const interfacePrimary = await primary(page)
  try {
    await save('#0f766e')
    await page.reload()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.locator('html')).toHaveCSS('font-size', '16px')
    // The organization color themes documents, never the interface.
    expect(await primary(page)).toBe(interfacePrimary)
  } finally {
    await save(savedColor)
  }
})
