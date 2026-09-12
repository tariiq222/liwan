import { expect, test, type Locator, type Page } from '@playwright/test'

const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
const LIGHT_SMALL_APPEARANCE = encodeURIComponent(JSON.stringify({ mode: 'light', fontSize: 'small' }))
const DARK_SMALL_APPEARANCE = encodeURIComponent(JSON.stringify({ mode: 'dark', fontSize: 'small' }))

const PRIMARY_COLOURS = ['#6758e8', '#0055ff', '#ffffff', '#000000', '#ffff00'] as const
const PREVIEW_MODES = {
  light: { label: 'فاتح', surface: '#ffffff' },
  cream: { label: 'كريمي', surface: '#fffdf8' },
  dark: { label: 'داكن', surface: '#181b24' },
} as const

type PreviewMode = keyof typeof PREVIEW_MODES

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
  await page.context().addCookies([{ name: 'nasq-appearance', value: LIGHT_SMALL_APPEARANCE, url: baseURL! }])
  await page.goto('/projects/dashboard')
  await expect(page).not.toHaveURL(/\/login/)
  return baseURL!
}

function hexToRgb(hex: string) {
  const value = hex.trim()
  if (value.startsWith('rgb')) return value
  const n = Number.parseInt(value.replace('#', ''), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

function parseCssColor(value: string) {
  const match = value.match(/^rgba?\(([^)]+)\)$/i)
  if (!match) return null
  const parts = match[1]!.replace('/', ' ').split(/[\s,]+/).filter(Boolean)
  const parseChannel = (channel: string) => channel.endsWith('%') ? Number.parseFloat(channel) * 2.55 : Number(channel)
  const channels = parts.slice(0, 3).map(parseChannel)
  const alphaValue = parts[3] ?? '1'
  const alpha = alphaValue.endsWith('%') ? Number.parseFloat(alphaValue) / 100 : Number(alphaValue)
  if (channels.length !== 3 || channels.some(channel => !Number.isFinite(channel)) || !Number.isFinite(alpha)) return null
  return { channels: channels as [number, number, number], alpha: Math.max(0, Math.min(1, alpha)) }
}

function cssChannels(value: string): [number, number, number] | null {
  return parseCssColor(value)?.channels ?? null
}

function compositeBackground(backgrounds: string[]) {
  let composited: { channels: [number, number, number]; alpha: number } | null = null
  for (const background of [...backgrounds].reverse()) {
    const parsed = parseCssColor(background)
    if (!parsed) continue
    if (!composited) {
      composited = parsed
      continue
    }
    const foregroundAlpha = parsed.alpha
    const remainingAlpha = 1 - foregroundAlpha
    composited = {
      channels: parsed.channels.map((channel, index) => (
        channel * foregroundAlpha + composited!.channels[index]! * remainingAlpha
      )) as [number, number, number],
      alpha: foregroundAlpha + composited.alpha * remainingAlpha,
    }
  }
  if (!composited || composited.alpha === 0) return null
  return `rgb(${composited.channels.map(channel => Math.round(channel)).join(', ')})`
}

function relativeLuminance(value: string) {
  const channels = cssChannels(value)
  if (!channels) return null
  const linear = channels.map(channel => {
    const normalized = channel / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
}

function contrastRatio(first: string, second: string) {
  const firstLuminance = relativeLuminance(first)
  const secondLuminance = relativeLuminance(second)
  if (firstLuminance === null || secondLuminance === null) return null
  const light = Math.max(firstLuminance, secondLuminance)
  const dark = Math.min(firstLuminance, secondLuminance)
  return (light + 0.05) / (dark + 0.05)
}

async function computedColours(element: Locator) {
  return element.evaluate((node) => {
    const backgrounds = []
    for (let current: Element | null = node; current; current = current.parentElement) {
      backgrounds.push(getComputedStyle(current).backgroundColor)
    }
    backgrounds.push(getComputedStyle(document.documentElement).backgroundColor)
    return { backgrounds, color: getComputedStyle(node).color }
  })
}

async function expectReadable(element: Locator, label: string) {
  await expect.poll(async () => {
    const colours = await computedColours(element)
    const background = compositeBackground(colours.backgrounds)
    return background ? contrastRatio(background, colours.color) ?? 0 : 0
  }, { message: label }).toBeGreaterThanOrEqual(4.5)
}

async function expectBackgroundContrast(element: Locator, surface: Locator, label: string) {
  await expect.poll(async () => {
    const [elementColours, surfaceColours] = await Promise.all([
      computedColours(element),
      computedColours(surface),
    ])
    const elementBackground = compositeBackground(elementColours.backgrounds)
    const surfaceBackground = compositeBackground(surfaceColours.backgrounds)
    return elementBackground && surfaceBackground ? contrastRatio(elementBackground, surfaceBackground) ?? 0 : 0
  }, { message: label }).toBeGreaterThanOrEqual(3)
}

async function expectPlaceholderReadable(input: Locator, label: string) {
  await expect.poll(async () => {
    const colours = await input.evaluate((node) => {
      const preview = node.closest('[data-testid="branding-preview"]')
      return {
        background: preview ? getComputedStyle(preview).backgroundColor : getComputedStyle(node).backgroundColor,
        color: getComputedStyle(node, '::placeholder').color,
      }
    })
    return contrastRatio(colours.background, colours.color) ?? 0
  }, { message: label }).toBeGreaterThanOrEqual(4.5)
}

async function previewSnapshot(preview: Locator) {
  return preview.evaluate((root) => {
    const style = getComputedStyle(root)
    const read = (element: Element | null) => {
      if (!element) return null
      const styles = getComputedStyle(element)
      return { background: styles.backgroundColor, color: styles.color }
    }
    return {
      primary: style.getPropertyValue('--primary').trim(),
      background: style.backgroundColor,
      action: read(root.querySelector('[data-testid="branding-preview-action"]')),
      selected: read(root.querySelector('.nasq-ui-selected')),
      charts: [...root.querySelectorAll('span.size-5.rounded-full')].map(element => getComputedStyle(element).backgroundColor),
      status: read([...root.querySelectorAll('[data-slot="root"]')].pop() ?? null),
    }
  })
}

async function choosePreviewMode(preview: Locator, mode: PreviewMode) {
  await preview.getByRole('button', { name: PREVIEW_MODES[mode].label, exact: true }).click()
  await expect(preview).toHaveCSS('background-color', hexToRgb(PREVIEW_MODES[mode].surface))
}

test('branding draft previews, cancels, resets, and saves the primary color explicitly', async ({ page, baseURL }) => {
  const runtimeBaseURL = await loginAsAdmin(page, baseURL)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/settings/branding')

  const colour = page.getByTestId('branding-color')
  const preview = page.getByTestId('branding-preview')
  const settingsBranding = page.locator('.nasq-settings-branding')
  await expect(colour).toBeVisible()
  await expect(settingsBranding).toHaveCount(1)
  await expect(settingsBranding).toBeVisible()
  await expect(preview).toBeVisible()
  await expect.poll(async () => (await preview.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(300)
  await expect(page.getByRole('status', { name: 'جارٍ تحميل إعدادات الهوية' })).toHaveCount(0)
  await expect(page.getByTestId('branding-name')).toHaveCount(0)
  await expect(page.getByTestId('branding-logo')).toHaveCount(0)
  await expect(page.getByTestId('branding-secondary-color')).toHaveCount(0)
  await expect(page.getByTestId('branding-suggest-secondary')).toHaveCount(0)
  await expect(page.getByTestId('branding-managed-identity')).toBeVisible()

  const savedBranding = await (await page.request.get('/api/v1/admin/branding')).json() as { name: string; logo_url: string | null }
  const savedName = savedBranding.name
  const savedLogo = savedBranding.logo_url
  const savedLogoResponse = savedLogo ? await page.request.get(new URL(savedLogo, runtimeBaseURL).toString()) : null
  if (savedLogoResponse) expect(savedLogoResponse.status()).toBe(200)
  const savedLogoBytes = savedLogoResponse ? await savedLogoResponse.body() : null
  const savedColour = await colour.inputValue()
  const initialTitle = await page.title()
  const initialPrimary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim())
  const shellBrand = page.getByTestId('shell-header').locator('.nasq-shell-brand')
  await expect(shellBrand).toBeVisible()
  expect(await shellBrand.getAttribute('aria-label')).toContain(savedName)

  try {
  await colour.fill('#ffffff')
  await expect(preview).toContainText(savedName)
  await expect(preview).toHaveAttribute('data-preview-primary', '#ffffff')
  const previewFillFg = await preview.evaluate((el) => getComputedStyle(el).getPropertyValue('--primary-fill-foreground').trim())
  const previewAction = preview.getByTestId('branding-preview-action')
  await expect(previewAction).toHaveCSS('color', hexToRgb(previewFillFg))
  await expectBackgroundContrast(previewAction, preview, 'white preview primary fill')
  await expect(shellBrand).toBeVisible()
  expect(await page.title()).toBe(initialTitle)
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim())).toBe(initialPrimary)

  let invalidPatchCount = 0
  const onInvalidRequest = (request: { url(): string; method(): string }) => {
    if (request.url().includes('/api/v1/admin/branding') && request.method() === 'PATCH') invalidPatchCount += 1
  }
  page.on('request', onInvalidRequest)
  await colour.fill('#fff')
  await expect(page.getByTestId('branding-submit')).toBeDisabled()
  await expect(page.getByTestId('branding-submit')).toHaveAttribute('aria-invalid', 'true')
  await expect(colour).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByTestId('branding-form').getByRole('alert')).toContainText('ست خانات')
  page.off('request', onInvalidRequest)
  expect(invalidPatchCount).toBe(0)
  await colour.fill('#ffffff')

  await page.getByTestId('branding-default').click()
  await page.getByTestId('branding-cancel').click()
  await expect(colour).toHaveValue(savedColour)

  let resetPatchCount = 0
  const onResetRequest = (request: { url(): string; method(): string }) => {
    if (request.url().includes('/api/v1/admin/branding') && request.method() === 'PATCH') resetPatchCount += 1
  }
  page.on('request', onResetRequest)
  await page.getByTestId('branding-default').click()
  await expect(colour).toHaveValue('#18181b')
  page.off('request', onResetRequest)
  expect(resetPatchCount).toBe(0)
  await expect(preview).toContainText(savedName)

  await colour.fill('#ffffff')
  const savedWhite = page.waitForResponse((response) => (
    response.url().includes('/api/v1/admin/branding') && response.request().method() === 'PATCH'
  ))
  await page.getByTestId('branding-submit').click()
  const savedWhiteResponse = await savedWhite
  expect(savedWhiteResponse.status()).toBe(200)
  expect(savedWhiteResponse.request().postDataJSON()).toEqual({ primary_color: '#ffffff' })
  const productionPrimary = page.getByTestId('branding-submit')
  await page.mouse.move(0, 0)
  const fill = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary-fill').trim())
  const fillFg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary-fill-foreground').trim())
  await expect(productionPrimary).toHaveCSS('background-color', hexToRgb(fill))
  await expect(productionPrimary).toHaveCSS('color', hexToRgb(fillFg))
  await expectReadable(productionPrimary, 'saved white primary action')
  await expectBackgroundContrast(productionPrimary, preview, 'white saved primary fill')
  const restBg = await productionPrimary.evaluate((el) => getComputedStyle(el).backgroundColor)
  const fillHover = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary-fill-hover').trim())
  await productionPrimary.hover()
  if (fillHover) await expect(productionPrimary).toHaveCSS('background-color', hexToRgb(fillHover))
  else await expect(productionPrimary).not.toHaveCSS('background-color', restBg)

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
  await expect(page.getByTestId('shell-header').locator('.nasq-shell-brand')).toBeVisible()
  expect(await page.getByTestId('shell-header').locator('.nasq-shell-brand').getAttribute('aria-label')).toContain(savedName)
  await expect(page).toHaveTitle(savedName)
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim())).toBe('#123456')
  await expect(page.getByTestId('branding-secondary-color')).toHaveCount(0)
  await expect(page.getByTestId('branding-suggest-secondary')).toHaveCount(0)
  const afterSave = await (await page.request.get('/api/v1/admin/branding')).json() as { name: string; logo_url: string | null; primary_color: string }
  expect(afterSave.primary_color).toBe('#123456')
  expect(afterSave.name).toBe(savedName)
  expect(logoUrlWithoutCacheVersion(afterSave.logo_url, runtimeBaseURL)).toBe(logoUrlWithoutCacheVersion(savedLogo, runtimeBaseURL))
  if (afterSave.logo_url) {
    const afterLogoResponse = await page.request.get(new URL(afterSave.logo_url, runtimeBaseURL).toString())
    expect(afterLogoResponse.status()).toBe(200)
    expect(await afterLogoResponse.body()).toEqual(savedLogoBytes)
  } else {
    expect(savedLogoBytes).toBeNull()
  }

  await page.getByTestId('branding-color').fill(savedColour)
  const restored = page.waitForResponse((response) => (
    response.url().includes('/api/v1/admin/branding') && response.request().method() === 'PATCH'
  ))
  await page.getByTestId('branding-submit').click()
  expect((await restored).status()).toBe(200)
  } finally {
    const restore = await page.request.patch('/api/v1/admin/branding', { data: { primary_color: savedColour } })
    expect(restore.status()).toBe(200)
  }
})

test('legacy secondary branding data cannot affect the rendered primary theme', async ({ page, baseURL }) => {
  await loginAsAdmin(page, baseURL)
  await page.goto('/settings/branding')
  const preview = page.getByTestId('branding-preview')
  const primary = page.getByTestId('branding-color')
  await expect(preview).toBeVisible()
  await expect(page.getByTestId('branding-secondary-color')).toHaveCount(0)
  const before = await previewSnapshot(preview)

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
  await expect(primary).toHaveValue(before.primary)
  await expect(page.getByTestId('branding-secondary-color')).toHaveCount(0)
  expect(await previewSnapshot(preview)).toEqual(before)
})

test('primary color matrix keeps preview actions, selection, charts, and semantic status readable', async ({ page, baseURL }) => {
  const runtimeBaseURL = await loginAsAdmin(page, baseURL)
  await page.context().addCookies([{ name: 'nasq-appearance', value: DARK_SMALL_APPEARANCE, url: runtimeBaseURL }])
  await page.goto('/settings/branding')
  const colour = page.getByTestId('branding-color')
  const preview = page.getByTestId('branding-preview')
  const action = preview.getByTestId('branding-preview-action')
  const selected = preview.locator('.nasq-ui-selected')
  const placeholder = preview.locator('input[placeholder]').first()
  const status = preview.locator('[data-slot="root"]').last()
  const statusByMode = new Map<PreviewMode, { background: string; color: string }>()

  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByTestId('branding-secondary-color')).toHaveCount(0)
  for (const primary of PRIMARY_COLOURS) {
    await colour.fill(primary)
    await expect(preview).toHaveAttribute('data-preview-primary', primary)
    for (const mode of Object.keys(PREVIEW_MODES) as PreviewMode[]) {
      await choosePreviewMode(preview, mode)
      await expect(placeholder).toBeVisible()
      await expectPlaceholderReadable(placeholder, `${primary}/${mode} preview placeholder`)
      await expect(action).toBeVisible()
      await expectReadable(action, `${primary}/${mode} primary action`)
      await action.hover()
      await expectReadable(action, `${primary}/${mode} hovered primary action`)

      const box = await action.boundingBox()
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.down()
        await expectReadable(action, `${primary}/${mode} active primary action`)
        await page.mouse.up()
      }

      await expectReadable(selected, `${primary}/${mode} selected text`)
      const snapshot = await previewSnapshot(preview)
      expect(snapshot.primary).toBe(primary)
      expect(snapshot.charts).toHaveLength(6)
      expect(new Set(snapshot.charts).size, `${primary}/${mode} chart colors`).toBe(6)
      await expect(status).toBeVisible()
      const statusColours = await computedColours(status)
      const priorStatus = statusByMode.get(mode)
      if (priorStatus) expect(statusColours).toEqual(priorStatus)
      else statusByMode.set(mode, statusColours)
    }
  }
})

test('branding presets and colour picker expose translated keyboard labels', async ({ page, baseURL }) => {
  await loginAsAdmin(page, baseURL)
  await page.goto('/settings/branding')
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

test('branding load errors are visible and retry is hydrated', async ({ page, baseURL }) => {
  await loginAsAdmin(page, baseURL)
  let available = false
  await page.route('**/api/v1/admin/branding', async (route) => {
    if (route.request().method() !== 'GET' || available) {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'unavailable', message: 'temporarily unavailable' }),
    })
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
