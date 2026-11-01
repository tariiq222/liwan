import { expect, test, type Page } from '@playwright/test'

const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
const LIGHT_SMALL_APPEARANCE = encodeURIComponent(JSON.stringify({ mode: 'light', fontSize: 'small' }))

function logoUrlWithoutCacheVersion(value: string | null, baseURL: string) {
  if (!value) return null
  const url = new URL(value, baseURL)
  url.searchParams.delete('v')
  return `${url.origin}${url.pathname}${url.search}`
}

// The caller must select an isolated scratch runtime; an exact port never proves DB isolation.
async function loginAsAdmin(page: Page, baseURL: string | undefined) {
  expect(baseURL).toBeDefined()
  const login = await page.request.post('/api/auth/login', {
    data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD },
  })
  expect(login.status()).toBe(200)
  await page.context().addCookies([{ name: 'liwan-appearance', value: LIGHT_SMALL_APPEARANCE, url: baseURL! }])
  await page.goto('/projects/dashboard')
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
  return baseURL!
}

async function logoBytes(page: Page, logoUrl: string, baseURL: string) {
  const result = await page.evaluate(async (url) => {
    const response = await fetch(url)
    return { status: response.status, bytes: [...new Uint8Array(await response.arrayBuffer())] }
  }, new URL(logoUrl, baseURL).toString())
  expect(result.status).toBe(200)
  return Buffer.from(result.bytes)
}

async function uiPrimary(page: Page) {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim())
}

test('document colour draft cancels, resets, and saves explicitly without theming the interface', async ({ page, baseURL }) => {
  const runtimeBaseURL = await loginAsAdmin(page, baseURL)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/settings/company#branding')

  const colour = page.getByTestId('branding-color')
  const settingsBranding = page.getByTestId('branding-form')
  await expect(colour).toBeVisible()
  await expect(settingsBranding).toHaveCount(1)
  await expect(settingsBranding).toBeVisible()
  await expect(page.getByTestId('branding-preview')).toHaveCount(0)
  await expect(page.getByRole('status', { name: 'جارٍ تحميل إعدادات الهوية' })).toHaveCount(0)
  await expect(page.getByTestId('branding-name')).toHaveCount(0)
  await expect(page.getByTestId('branding-logo')).toHaveCount(0)
  await expect(page.getByTestId('branding-secondary-color')).toHaveCount(0)
  await expect(page.getByTestId('branding-suggest-secondary')).toHaveCount(0)
  await expect(settingsBranding.getByText('لا يغيّر هذا ألوان الواجهة')).toBeVisible()

  const savedBranding = await (await page.request.get('/api/v1/admin/branding')).json() as { name: string; logo_url: string | null }
  const savedName = savedBranding.name
  const savedLogo = savedBranding.logo_url
  const savedLogoBytes = savedLogo ? await logoBytes(page, savedLogo, runtimeBaseURL) : null
  const savedColour = await colour.inputValue()
  const initialTitle = await page.title()
  const initialPrimary = await uiPrimary(page)
  const shellBrand = page.getByTestId('shell-header').locator('.liwan-shell-brand')
  await expect(shellBrand).toBeVisible()
  expect(await shellBrand.getAttribute('aria-label')).toContain(savedName)

  try {
  await colour.fill('#ffffff')
  await expect(shellBrand).toBeVisible()
  expect(await page.title()).toBe(initialTitle)
  expect(await uiPrimary(page)).toBe(initialPrimary)

  let invalidPatchCount = 0
  const onInvalidRequest = (request: { url(): string; method(): string }) => {
    if (request.url().includes('/api/v1/admin/branding') && request.method() === 'PATCH') invalidPatchCount += 1
  }
  page.on('request', onInvalidRequest)
  await colour.fill('#fff')
  await expect(colour).toHaveAttribute('aria-invalid', 'true')
  // The field explains itself once the reader submits; a draft that is not valid never reaches the server.
  await page.getByTestId('branding-form').getByRole('button', { name: 'حفظ التغييرات', exact: true }).click()
  await expect(page.getByTestId('branding-form').getByRole('alert').filter({ hasText: 'ست خانات' }).first()).toBeVisible()
  await expect(page.getByTestId('branding-form').getByRole('alert').filter({ hasText: 'تعذّر الحفظ' })).toBeVisible()
  page.off('request', onInvalidRequest)
  expect(invalidPatchCount).toBe(0)
  await colour.fill('#ffffff')

  // Another preset than the default, which is also the mock's saved color: undo needs a draft that differs from it.
  await page.getByTestId('branding-preset').nth(1).click()
  await page.getByTestId('branding-form').getByRole('button', { name: 'تراجع', exact: true }).click()
  await expect(colour).toHaveValue(savedColour)

  let resetPatchCount = 0
  const onResetRequest = (request: { url(): string; method(): string }) => {
    if (request.url().includes('/api/v1/admin/branding') && request.method() === 'PATCH') resetPatchCount += 1
  }
  page.on('request', onResetRequest)
  await page.getByTestId('branding-preset').first().click()
  await expect(colour).toHaveValue('#5b3f8c')
  page.off('request', onResetRequest)
  expect(resetPatchCount).toBe(0)

  await colour.fill('#123456')
  const saved = page.waitForResponse((response) => (
    response.url().includes('/api/v1/admin/branding') && response.request().method() === 'PATCH'
  ))
  await page.getByTestId('branding-form').getByRole('button', { name: 'حفظ التغييرات', exact: true }).click()
  const savedResponse = await saved
  expect(savedResponse.status()).toBe(200)
  expect(savedResponse.request().postDataJSON()).toEqual({ primary_color: '#123456' })
  await page.reload()
  await expect(page.getByTestId('branding-color')).toHaveValue('#123456')
  await expect(page.getByTestId('shell-header').locator('.liwan-shell-brand')).toBeVisible()
  expect(await page.getByTestId('shell-header').locator('.liwan-shell-brand').getAttribute('aria-label')).toContain(savedName)
  await expect(page).toHaveTitle(savedName)
  // The saved colour is for documents; the interface keeps the fixed LiwanOS palette.
  expect(await uiPrimary(page)).toBe(initialPrimary)
  await expect(page.getByTestId('branding-secondary-color')).toHaveCount(0)
  await expect(page.getByTestId('branding-suggest-secondary')).toHaveCount(0)
  const afterSave = await (await page.request.get('/api/v1/admin/branding')).json() as { name: string; logo_url: string | null; primary_color: string }
  expect(afterSave.primary_color).toBe('#123456')
  expect(afterSave.name).toBe(savedName)
  expect(logoUrlWithoutCacheVersion(afterSave.logo_url, runtimeBaseURL)).toBe(logoUrlWithoutCacheVersion(savedLogo, runtimeBaseURL))
  if (afterSave.logo_url) {
    expect(await logoBytes(page, afterSave.logo_url, runtimeBaseURL)).toEqual(savedLogoBytes)
  } else {
    expect(savedLogoBytes).toBeNull()
  }

  await page.getByTestId('branding-color').fill(savedColour)
  const restored = page.waitForResponse((response) => (
    response.url().includes('/api/v1/admin/branding') && response.request().method() === 'PATCH'
  ))
  await page.getByTestId('branding-form').getByRole('button', { name: 'حفظ التغييرات', exact: true }).click()
  expect((await restored).status()).toBe(200)
  } finally {
    const restore = await page.request.patch('/api/v1/admin/branding', { data: { primary_color: savedColour } })
    expect(restore.status()).toBe(200)
  }
})

test('legacy secondary branding data cannot reach the form or the interface theme', async ({ page, baseURL }) => {
  await loginAsAdmin(page, baseURL)
  await page.goto('/settings/company#branding')
  const primary = page.getByTestId('branding-color')
  await expect(primary).toBeVisible()
  await expect(page.getByTestId('branding-secondary-color')).toHaveCount(0)
  const before = { colour: await primary.inputValue(), ui: await uiPrimary(page) }

  const addLegacySecondary = async (route: import('@playwright/test').Route) => {
    const response = await route.fetch()
    const body = await response.json() as Record<string, unknown>
    await route.fulfill({ response, json: { ...body, secondary_color: '#ffff00' } })
  }
  await page.route('**/api/v1/branding', addLegacySecondary)
  await page.route('**/api/v1/admin/branding', async (route) => {
    if (route.request().method() === 'GET') return addLegacySecondary(route)
    await route.continue()
  })
  await page.reload()
  await expect(primary).toHaveValue(before.colour)
  await expect(page.getByTestId('branding-secondary-color')).toHaveCount(0)
  expect(await uiPrimary(page)).toBe(before.ui)
})

test('branding presets and colour picker expose translated keyboard labels', async ({ page, baseURL }) => {
  await loginAsAdmin(page, baseURL)
  await page.goto('/settings/company#branding')
  const preset = page.getByTestId('branding-preset').first()
  await expect(preset).toHaveAttribute('aria-label', /.+/)
  await preset.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('branding-color')).toHaveValue(/#[0-9a-fA-F]{6}/)
  await expect(page.getByTestId('branding-color-picker')).toHaveAttribute('aria-label', /.+/)
  await expect(page.getByTestId('branding-secondary-color')).toHaveCount(0)
})

test('a failed branding save keeps the primary draft visible', async ({ page, baseURL }) => {
  await loginAsAdmin(page, baseURL)
  await page.goto('/settings/company#branding')
  await page.route('**/api/v1/admin/branding', async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'unavailable', message: 'temporarily unavailable' }) })
      return
    }
    await route.continue()
  })

  await page.getByTestId('branding-color').fill('#123456')
  const failed = page.waitForResponse((response) => (
    response.url().includes('/api/v1/admin/branding') && response.request().method() === 'PATCH'
  ))
  await page.getByTestId('branding-form').getByRole('button', { name: 'حفظ التغييرات', exact: true }).click()
  expect((await failed).status()).toBe(503)
  await expect(page.getByTestId('branding-color')).toHaveValue('#123456')
})

