import { test, expect, type Page } from '@playwright/test'

test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Isolated synthetic project API only')

async function ready(page: Page) {
  await expect(page.getByTestId('project-workspace-settings')).toBeVisible()
  await expect(page.getByTestId('project-workspace-tabs')).toBeVisible()
  await expect(page.getByTestId('project-workspace-name')).toHaveText('مشروع ألفا')
  await expect(page.locator('main h1')).toHaveCount(1)
  await expect(page.locator('main [role="alert"]')).toHaveCount(0)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
})

const sections = [
  ['tasks', '/projects/1?tab=tasks'],
  ['board', '/projects/1?tab=board'],
  ['milestones', '/projects/1?tab=milestones'],
  ['summary', '/projects/1?tab=summary'],
  ['stakeholders', '/projects/1/stakeholders'],
  ['raci', '/projects/1/raci'],
  ['register', '/projects/1/register'],
  ['finance', '/projects/1/finance'],
  ['charter', '/projects/1/charter'],
  ['settings', '/projects/1/settings'],
  ['schedule', '/projects/1/schedule'],
  ['updates', '/projects/1/updates'],
] as const

for (const width of [1440, 1024]) {
  test(`all project sections align their header and content at ${width}px`, async ({ page }, info) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width, height: 1000 })
    let baseline: { x: number; width: number; y: number } | undefined
    for (const [name, path] of sections) {
      await page.goto(path)
      await ready(page)
      // The workspace frame (title row + tabs) and every container under it share one column.
      const frame = page.getByTestId('project-workspace-frame')
      await expect(frame).toHaveAttribute('data-layout-width', 'list')
      const frameBox = (await frame.boundingBox())!
      baseline ??= frameBox
      expect(Math.abs(frameBox.x - baseline.x), name).toBeLessThanOrEqual(1)
      expect(Math.abs(frameBox.width - baseline.width), name).toBeLessThanOrEqual(1)
      const boxes = await page.locator('[data-slot="page-container"][data-page-record="true"]').evaluateAll(nodes => nodes.map((node) => {
        const rect = node.getBoundingClientRect()
        return { x: rect.x, width: rect.width }
      }))
      expect(boxes.length, name).toBeGreaterThan(0)
      for (const box of boxes) {
        expect(Math.abs(box.x - frameBox.x), name).toBeLessThanOrEqual(1)
        expect(Math.abs(box.width - frameBox.width), name).toBeLessThanOrEqual(1)
      }
      // A section that has its own page header places it below the frame, on the same column.
      const heading = page.locator('main [data-slot="page-header"]')
      if (await heading.count()) {
        const header = (await heading.first().boundingBox())!
        expect(frameBox.y + frameBox.height, name).toBeLessThanOrEqual(header.y + 1)
        expect(Math.abs(header.width - frameBox.width), name).toBeLessThanOrEqual(1)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name).toBe(true)
      if (['tasks', 'board', 'stakeholders', 'raci', 'register', 'finance'].includes(name)) {
        // From md the filters sit inline in the list card; the filters button belongs to the phone.
        await expect(page.locator('main [data-slot="filter-root"] [data-slot="search"]')).toBeVisible()
        await expect(page.getByRole('button', { name: 'البحث والفلاتر', exact: true })).toBeHidden()
      }
      if (['tasks', 'board', 'milestones', 'summary', 'stakeholders', 'register', 'finance', 'schedule'].includes(name)) {
        // Header create actions may be route links (UButton :to) or buttons.
        await expect(heading.first().locator('button, a').first()).toBeEnabled()
      }
      if (name === 'charter') await expect(page.getByTestId('project-charter-print')).toBeEnabled()
      await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: true })
    }
  })
}

test('project task filters survive view changes and reload; create stays in the header', async ({ page }) => {
  await page.goto('/projects/1?tab=tasks')
  await ready(page)
  const header = page.locator('main [data-slot="page-header"]')
  await expect(header.getByTestId('project-header-create')).toBeEnabled()
  const search = page.locator('main [data-shortcut-search] input')
  await expect(search).toBeEnabled()
  await search.fill('جارية')
  await expect(page).toHaveURL(/q=/)
  await page.getByRole('button', { name: 'لوحة', exact: true }).click()
  expect(new URL(page.url()).searchParams.get('q')).toBe('جارية')
  await page.reload()
  await ready(page)
  await expect(search).toHaveValue('جارية')
  await header.getByTestId('project-header-create').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  // The create panel opens over the list and the route keeps its filters.
  expect(new URL(page.url()).pathname).toBe('/projects/1/tasks/new')
  expect(new URL(page.url()).searchParams.get('q')).toBe('جارية')
})

test('schedule toolbar changes scale and retains it after reload', async ({ page }) => {
  await page.goto('/projects/1/schedule')
  await ready(page)
  await page.getByRole('group', { name: 'مقياس العرض' }).getByRole('button', { name: 'شهري', exact: true }).click()
  await expect(page).toHaveURL(/scale=month/)
  await page.reload()
  await ready(page)
  await expect(page.getByRole('group', { name: 'مقياس العرض' }).getByRole('button', { name: 'شهري', exact: true })).toHaveAttribute('aria-pressed', 'true')
})
