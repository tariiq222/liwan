import { expect, test } from '@playwright/test'

async function loginAsAdmin(page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
}

test('branding draft previews, cancels, resets to default, and saves explicitly', async ({ page }) => {
  await loginAsAdmin(page)
  await page.goto('/settings/branding')

  const colour = page.getByTestId('branding-color')
  const preview = page.getByTestId('branding-preview')
  await expect(colour).toBeVisible()
  await expect(page.getByTestId('branding-name')).toHaveCount(0)
  await expect(page.getByTestId('branding-logo')).toHaveCount(0)
  await expect(page.getByTestId('branding-managed-identity')).toBeVisible()

  const savedName = await page.title()
  const savedColour = await colour.inputValue()
  const initialTitle = await page.title()
  const initialPrimary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim())
  const shell = page.locator('[data-sidebar="sidebar"]')
  const shellBrand = shell.getByText(savedName, { exact: true })
  await expect(shellBrand).toBeVisible()

  await colour.fill('#ffffff')
  await expect(preview).toContainText(savedName)
  await expect(preview).toHaveAttribute('data-preview-primary', '#ffffff')
  await expect(preview.getByTestId('branding-preview-action')).toHaveCSS('color', 'rgb(0, 0, 0)')
  await expect(preview.getByTestId('branding-preview-action')).toHaveCSS('border-top-style', 'solid')
  await expect(preview.getByTestId('branding-preview-action')).toHaveCSS('border-top-width', /[1-9]px/)
  await expect(shellBrand).toBeVisible()
  expect(await page.title()).toBe(initialTitle)
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim())).toBe(initialPrimary)

  let invalidPatchCount = 0
  const onInvalidRequest = (request) => {
    if (request.url().includes('/api/v1/admin/branding') && request.method() === 'PATCH') invalidPatchCount += 1
  }
  page.on('request', onInvalidRequest)
  await colour.fill('#fff')
  await expect(page.getByTestId('branding-submit')).toBeDisabled()
  await expect(page.getByTestId('branding-submit')).toHaveAttribute('aria-invalid', 'true')
  await expect(colour).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('alert')).toContainText('ست خانات')
  page.off('request', onInvalidRequest)
  expect(invalidPatchCount).toBe(0)
  await colour.fill('#ffffff')

  await page.getByTestId('branding-default').click()
  await page.getByTestId('branding-cancel').click()
  await expect(colour).toHaveValue(savedColour)

  let resetPatchCount = 0
  const onRequest = (request) => {
    if (request.url().includes('/api/v1/admin/branding') && request.method() === 'PATCH') resetPatchCount += 1
  }
  page.on('request', onRequest)
  await page.getByTestId('branding-default').click()
  await expect(colour).toHaveValue('#18181b')
  page.off('request', onRequest)
  expect(resetPatchCount).toBe(0)
  await expect(page.getByTestId('branding-preview')).toContainText(savedName)

  await colour.fill('#ffffff')
  const savedWhite = page.waitForResponse((response) => (
    response.url().includes('/api/v1/admin/branding') && response.request().method() === 'PATCH'
  ))
  await page.getByTestId('branding-submit').click()
  expect((await savedWhite).status()).toBe(200)
  const productionPrimary = page.getByTestId('branding-submit')
  await expect(productionPrimary).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(productionPrimary).toHaveCSS('color', 'rgb(0, 0, 0)')
  await expect(productionPrimary).toHaveCSS('border-top-style', 'solid')
  await expect(productionPrimary).toHaveCSS('border-top-width', /[1-9]px/)

  await colour.fill('#123456')
  const saved = page.waitForResponse((response) => (
    response.url().includes('/api/v1/admin/branding') && response.request().method() === 'PATCH'
  ))
  await page.getByTestId('branding-submit').click()
  const savedResponse = await saved
  expect(savedResponse.status()).toBe(200)
  expect(savedResponse.request().postDataJSON()).toEqual({ primary_color: '#123456' })
  await page.reload()
  await expect(page.getByTestId('branding-color')).toHaveValue('#123456')
  await expect(page.locator('[data-sidebar="sidebar"]').getByText(savedName, { exact: true })).toBeVisible()
  await expect(page).toHaveTitle(savedName)
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim())).toBe('#123456')

  await page.getByTestId('branding-color').fill(savedColour)
  const restored = page.waitForResponse((response) => (
    response.url().includes('/api/v1/admin/branding') && response.request().method() === 'PATCH'
  ))
  await page.getByTestId('branding-submit').click()
  expect((await restored).status()).toBe(200)
})

test('branding presets and colour picker expose translated keyboard labels', async ({ page }) => {
  await loginAsAdmin(page)
  await page.goto('/settings/branding')
  const preset = page.getByTestId('branding-preset').first()
  await expect(preset).toHaveAttribute('aria-label', /.+/)
  await preset.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('branding-color')).toHaveValue(/#[0-9a-fA-F]{6}/)
  await expect(page.getByTestId('branding-color-picker')).toHaveAttribute('aria-label', /.+/)
})

test('a failed branding save keeps the draft visible', async ({ page }) => {
  await loginAsAdmin(page)
  await page.goto('/settings/branding')
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
  await page.getByTestId('branding-submit').click()
  expect((await failed).status()).toBe(503)
  await expect(page.getByTestId('branding-color')).toHaveValue('#123456')
})

test('branding load errors are visible and retry is hydrated', async ({ page }) => {
  await loginAsAdmin(page)
  let available = false
  await page.route('**/api/v1/admin/branding', async (route) => {
    if (route.request().method() !== 'GET' || available) {
      await route.continue()
      return
    }
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'unavailable', message: 'temporarily unavailable' }) })
  })
  await page.goto('/settings/branding')
  await expect(page).toHaveURL(/\/settings\/branding$/)
  await page.waitForFunction(() => (document.getElementById('__nuxt') as { __vue_app__?: unknown } | null)?.__vue_app__)
  await page.evaluate(async () => {
    const app = (document.getElementById('__nuxt') as { __vue_app__?: { _context?: { provides?: Record<PropertyKey, unknown> } } } | null)?.__vue_app__
    const provides = app?._context?.provides ?? {}
    const provided = [
      ...Object.values(provides),
      ...Object.getOwnPropertySymbols(provides).map((key) => provides[key]),
    ]
    const client = provided.find((value) => (
      value && typeof value === 'object' && typeof (value as { resetQueries?: unknown }).resetQueries === 'function' && typeof (value as { getQueryCache?: unknown }).getQueryCache === 'function'
    )) as { resetQueries: (opts: { queryKey: string[] }) => Promise<unknown> } | undefined
    if (!client) throw new Error('vue-query client missing')
    await client.resetQueries({ queryKey: ['branding-admin'] })
  })
  await expect(page.getByTestId('branding-load-error')).toBeVisible()
  const retry = page.getByTestId('branding-retry')
  await expect(retry).toBeEnabled()
  available = true
  await retry.click()
  await expect(page.getByTestId('branding-form')).toBeVisible()
})
