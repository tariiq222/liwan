import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ timeout: 30_000 })
test.skip(
  process.env.E2E_BASE_URL !== 'http://127.0.0.1:4597',
  'Run against the isolated Projects mock server, never the canonical app port.',
)

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).toHaveURL(/\/tasks$/)
}

async function assertNoContextAndNoGutter(page: Page, width: number) {
  await expect(page.getByTestId('context-sidebar')).toHaveCount(0)
  await expect(page.getByTestId('shell-main')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)

  await expect.poll(async () => page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>('[data-testid="module-rail"]')!
    const workspace = document.querySelector<HTMLElement>('.nasq-shell-workspace')!
    return Math.abs(parseFloat(getComputedStyle(workspace).marginInlineStart || '0') - rail.getBoundingClientRect().width) <= 0.5
  }), { timeout: 5_000, intervals: [50, 100, 200] }).toBe(true)

  const geometry = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('[data-nasq-shell]')!
    const rail = document.querySelector<HTMLElement>('[data-testid="module-rail"]')!
    const workspace = document.querySelector<HTMLElement>('.nasq-shell-workspace')!
    const main = document.querySelector<HTMLElement>('[data-testid="shell-main"]')!
    const railWidth = rail.getBoundingClientRect().width
    const workspaceStyle = getComputedStyle(workspace)
    return {
      direction: shell.dataset.direction,
      railWidth,
      workspaceStart: parseFloat(workspaceStyle.marginInlineStart || '0'),
      mainTop: main.getBoundingClientRect().top,
      headerBottom: document.querySelector<HTMLElement>('.nasq-shell-header')!.getBoundingClientRect().bottom,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }
  })

  expect(geometry.direction).toBe('rtl')
  expect(geometry.workspaceStart, `context gutter at ${width}px`).toBe(geometry.railWidth)
  expect(geometry.overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1)
  expect(geometry.mainTop, `content overlaps header at ${width}px`).toBeGreaterThanOrEqual(geometry.headerBottom)
}

test('Projects module opens the list directly and keeps list views free of context navigation', async ({ page }) => {
  await login(page)
  await page.getByTestId('module-rail').getByRole('link', { name: 'المشاريع', exact: true }).click()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.getByRole('heading', { name: 'المشاريع', exact: true })).toBeVisible()
  await expect(page.getByTestId('context-link-templates')).toHaveCount(0)
  await page.getByTestId('module-rail-toggle').click()
  await assertNoContextAndNoGutter(page, 1440)

  for (const view of ['table', 'cards', 'reports'] as const) {
    if (view !== 'table') await page.getByTestId(`projects-view-${view}`).click()
    await expect(page).toHaveURL((url) => url.pathname === '/projects' && (view === 'table' || url.searchParams.get('view') === view))
    await assertNoContextAndNoGutter(page, 1440)
  }
})

test('Project creation also uses the workspace without a contextual sidebar', async ({ page }) => {
  await login(page)
  await page.goto('/projects/new')
  await expect(page.getByTestId('project-create-form')).toBeVisible()
  await assertNoContextAndNoGutter(page, 1440)
})

test('Project details show project context while settings owns template navigation', async ({ page }) => {
  await login(page)
  await page.goto('/projects/1')
  await expect(page.getByRole('heading', { name: 'نظرة عامة', exact: true, level: 1 })).toBeVisible()
  const contextSidebar = page.getByTestId('context-sidebar')
  await expect(contextSidebar).toBeVisible()
  await expect(contextSidebar.getByRole('heading', { name: 'مشروع ألفا', exact: true, level: 2 })).toBeVisible()
  await expect(contextSidebar.getByTestId('context-link-summary')).toBeVisible()

  await page.goto('/settings/projects')
  await expect(page.getByTestId('context-sidebar')).toBeVisible()
  await expect(page.getByTestId('context-link-templates')).toHaveAttribute('href', /\/project-templates/)
})

test('No-context Projects views stay within the viewport at the approved widths', async ({ page }) => {
  await login(page)
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/projects?view=reports')
    await expect(page.getByTestId('projects-view-reports')).toHaveAttribute('aria-pressed', 'true')
    await assertNoContextAndNoGutter(page, width)
  }
})
