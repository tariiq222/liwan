import { expect, test, type Locator, type Page } from '@playwright/test'

const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
const LIGHT_SMALL_APPEARANCE = encodeURIComponent(JSON.stringify({ mode: 'light', fontSize: 'small' }))

// The caller must select an isolated scratch runtime; an exact port never proves DB isolation.
async function login(page: Page, baseURL: string | undefined) {
  // The runner-provided endpoint must point at the selected isolated scratch runtime.
  expect(baseURL).toBeDefined()
  const response = await page.request.post('/api/auth/login', {
    data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD },
  })
  expect(response.status()).toBe(200)
  await page.context().addCookies([{
    name: 'webvue-appearance',
    value: LIGHT_SMALL_APPEARANCE,
    url: baseURL!,
  }])
  await page.goto('/projects/dashboard')
  await expect(page).not.toHaveURL(/\/login/)
}

async function setShellState(page: Page, state: { contextExpanded: boolean }) {
  const contextToggle = page.getByTestId('context-sidebar-toggle')
  await expect(contextToggle).toBeEnabled()
  if ((await contextToggle.getAttribute('aria-expanded')) !== String(state.contextExpanded)) await contextToggle.click()
  await expect(contextToggle).toHaveAttribute('aria-expanded', String(state.contextExpanded))
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
}

async function expectDrawnIcon(icon: Locator) {
  await expect(icon).toBeVisible()
  await expect.poll(() => icon.evaluate(element => {
    const style = getComputedStyle(element)
    const hasSvg = Boolean(element.querySelector('svg'))
    const hasMask = [style.getPropertyValue('mask-image'), style.getPropertyValue('-webkit-mask-image')]
      .some(value => value !== '' && value !== 'none')
    const hasBackground = style.backgroundImage !== '' && style.backgroundImage !== 'none'
    return hasSvg || hasMask || hasBackground
  })).toBe(true)
}

test('shell follows the approved neutral frame and independent desktop collapse', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await login(page, baseURL)
  await setShellState(page, { contextExpanded: true })

  const header = page.getByTestId('shell-header')
  const rail = page.getByTestId('module-rail')
  const context = page.getByTestId('context-sidebar')
  const main = page.getByTestId('shell-main')
  await expect(page.locator('main h1')).toHaveCount(1)
  await expect(header.locator('h1')).toHaveCount(0)
  await expect(header).toHaveCSS('height', '48px')
  await expect(rail).toHaveCSS('width', '64px')
  await expect(context).toHaveCSS('width', '232px')
  await expect(page.locator('main [data-slot="root"][class*="ring-default"]').first()).toBeVisible()
  await expect(page.getByTestId('context-link-new-project')).toBeVisible()

  const surfaces = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('[data-testid="shell-header"]')!
    const main = document.querySelector<HTMLElement>('[data-testid="shell-main"]')!
    const card = document.querySelector<HTMLElement>('main [data-slot="root"][class*="ring-default"]')
    const create = document.querySelector<HTMLElement>('[data-testid="context-link-new-project"]')
    const css = (element: HTMLElement) => {
      const styles = getComputedStyle(element)
      return { background: styles.backgroundColor, color: styles.color, shadow: styles.boxShadow }
    }
    // Resolve --ui-border through a probe so the comparison is computed-colour to computed-colour.
    const probe = document.createElement('span')
    probe.style.color = 'var(--ui-border)'
    document.body.appendChild(probe)
    const uiBorder = getComputedStyle(probe).color
    probe.remove()
    const headerStyles = getComputedStyle(header)
    return {
      header: { ...css(header), borderWidth: parseFloat(headerStyles.borderBlockEndWidth), borderColor: headerStyles.borderBlockEndColor, uiBorder },
      canvas: css(main).background,
      card: card ? css(card) : null,
      create: create ? css(create) : null,
    }
  })
  // Tasmim: the header and the canvas share one neutral surface; the header is set apart by its bottom border.
  expect(surfaces.header.borderWidth).toBeGreaterThanOrEqual(1)
  expect(surfaces.header.borderColor).toBe(surfaces.header.uiBorder)
  expect(surfaces.card).not.toBeNull()
  // Tasmim cards share the canvas colour and are set apart by the hairline ring (a box-shadow ring), not a fill.
  expect(surfaces.card!.shadow).not.toBe('none')
  expect(surfaces.create).not.toBeNull()
  expect(surfaces.create!.color).not.toBe(surfaces.create!.background)

  const railLinks = rail.locator('.webvue-module-rail-link')
  expect(await railLinks.count()).toBeGreaterThan(0)
  for (const link of await railLinks.all()) {
    const icon = link.locator('.webvue-shell-icon')
    await expect(icon).toHaveCount(1)
    await expectDrawnIcon(icon)
  }

  // One rail width (Tasmim spec §5); only the context sidebar collapses.
  await expect(page.getByTestId('module-rail-toggle')).toHaveCount(0)
  const contextToggle = page.getByTestId('context-sidebar-toggle')
  await contextToggle.click()
  await expect(context).toHaveCSS('width', '48px')
  await expect(rail).toHaveCSS('width', '64px')
  await contextToggle.click()
  await expect(context).toHaveCSS('width', '232px')
  await expect(rail).toHaveCSS('width', '64px')
  await expect(context).toBeVisible()
})

test('module context follows direct routes and refresh', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await login(page, baseURL)
  await setShellState(page, { contextExpanded: true })

  await page.goto('/projects')
  const context = page.getByTestId('context-sidebar')
  await expect(context.getByRole('link', { name: 'كل المشاريع', exact: true })).toBeVisible()
  await page.reload()
  await expect(context.getByRole('link', { name: 'كل المشاريع', exact: true })).toBeVisible()

  // My tasks belongs to the projects module and keeps the same sidebar.
  await page.goto('/tasks')
  await expect(context.getByRole('link', { name: 'كل المشاريع', exact: true })).toBeVisible()
  await expect(page.getByTestId('context-link-tasks')).toHaveAttribute('aria-current', 'page')
  await page.reload()
  await expect(context.getByTestId('context-link-tasks')).toHaveAttribute('aria-current', 'page')

  await page.goto('/meetings')
  await expect(context.getByRole('link', { name: 'كل المشاريع', exact: true })).toHaveCount(0)
  await expect(context.getByTestId('context-link-meetings')).toHaveAttribute('aria-current', 'page')
  await page.reload()
  await expect(context).toBeVisible()
  await expect(context.getByTestId('context-link-meetings')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('main h1')).toHaveCount(1)
})

test('mobile navigation replaces desktop columns and retains module and context links', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, baseURL)
  await expect(page.getByTestId('module-rail')).toBeHidden()
  await expect(page.getByTestId('context-sidebar')).toBeHidden()
  await expect(page.getByTestId('mobile-navigation-trigger')).toBeEnabled()
  await expect(page.getByTestId('mobile-navigation-trigger')).toHaveAttribute('aria-expanded', 'false')
  const header = page.getByTestId('shell-header')
  await expect(header.locator('.webvue-search-trigger')).toBeVisible()
  const searchIcon = header.locator('.webvue-search-trigger .iconify')
  await expect(searchIcon).toHaveCount(1)
  await expectDrawnIcon(searchIcon)

  const menuToggle = page.getByTestId('mobile-navigation-trigger')
  await menuToggle.click()
  const menu = page.locator('#mobile-navigation')
  await expect(menu).toBeVisible()
  for (const name of ['نظرة عامة', 'المشاريع', 'الاجتماعات', 'المحادثات', 'المؤسسة', 'الإعدادات']) {
    await expect(menu.getByRole('link', { name, exact: true })).toBeVisible()
  }
  await expect(menu.getByTestId('mobile-context-link-tasks')).toBeVisible()
  await menu.getByRole('link', { name: 'المشاريع', exact: true }).click()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(menu).toBeHidden()
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'false')
  await expectNoHorizontalOverflow(page)
})

for (const width of [390, 768, 1440]) {
  test(`shell remains usable at ${width}px with large type and every appearance mode`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height: 1000 })
    await login(page, baseURL)
    const rail = page.getByTestId('module-rail')
    const context = page.getByTestId('context-sidebar')
    if (width < 768) {
      await expect(rail).toBeHidden()
      await expect(context).toBeHidden()
    } else {
      await expect(rail).toBeVisible()
      await expect(context).toBeVisible()
      await setShellState(page, { contextExpanded: true })
    }

    for (const mode of ['light', 'dark']) {
      // The preference is per user on the server; the header menu writes the same endpoint.
      await page.request.patch('/api/v1/me/appearance', { data: { mode, font_size: 'large' } })
      await page.goto('/tasks')
      await expect(page.locator('html')).toHaveAttribute('data-font-size', 'large')
      if (mode === 'dark') {
        await expect(page.locator('html')).toHaveClass(/dark/)
      } else {
        await expect(page.locator('html')).not.toHaveClass(/dark/)
      }
      await expect(page.locator('main h1')).toHaveCount(1)
      await expect(page.getByRole('button', { name: 'بحث', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: /^حسابي/ })).toBeVisible()
      if (width < 768) await expectDrawnIcon(page.getByTestId('shell-header').locator('.webvue-search-trigger .iconify'))
      await expectNoHorizontalOverflow(page)
    }
  })
}
