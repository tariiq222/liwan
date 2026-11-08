import { expect, test } from '@playwright/test'
import { DESKTOP, PHONE, expectFrameOwnsH1, fitsWidth, login, open } from './support/tasmim6'
import { openProjectMenu } from './support/projectMenu'

// The project page frame: a one-row header, five tabs on one line, the summary hosting the updates, and the old addresses of
// the sections that merged. Runs against the isolated project mock (the data of e2e/pmo-ui-preview-data.mjs).
test.beforeEach(async ({ page }) => { await login(page) })

test.describe('desktop', () => {
  test.use({ viewport: DESKTOP })

  test('the header is one row: the title with one status badge, a muted meta line and the actions', async ({ page }) => {
    await open(page, '/projects/1')
    await expectFrameOwnsH1(page)
    const frame = page.getByTestId('project-workspace-frame')
    const name = (await page.getByTestId('project-workspace-name').boundingBox())!
    const create = (await frame.getByTestId('project-header-create').boundingBox())!
    const menu = (await page.getByTestId('project-workspace-menu').boundingBox())!
    // The title, the primary action and the menu share the identity row.
    expect(Math.abs((create.y + create.height / 2) - (name.y + name.height / 2))).toBeLessThan(name.height)
    expect(Math.abs((menu.y + menu.height / 2) - (create.y + create.height / 2))).toBeLessThan(create.height)
    await expect(frame.getByTestId('project-status')).toHaveCount(1)
    // Owner and dates are plain text under the title, not tags.
    const meta = frame.getByTestId('project-workspace-meta')
    await expect(meta).toBeVisible()
    await expect(meta.locator('[data-slot="badge"]')).toHaveCount(0)
    expect((await meta.boundingBox())!.y).toBeGreaterThanOrEqual(name.y + name.height - 2)
    // Nothing below the tabs repeats an action row.
    await expect(page.locator('main [data-slot="page-header"]')).toHaveCount(0)
  })

  test('there are five tabs on one line', async ({ page }) => {
    await open(page, '/projects/1')
    const tabs = page.getByTestId('project-workspace-tabs').getByRole('link')
    expect((await tabs.allTextContents()).map(text => text.trim())).toEqual(['الملخص', 'المهام', 'الاجتماعات', 'المالية', 'الحوكمة'])
    const tops = await tabs.evaluateAll(links => links.map(link => Math.round(link.getBoundingClientRect().top)))
    expect(new Set(tops).size).toBe(1)
    await expect(page.getByTestId('project-tab-summary')).toHaveAttribute('aria-current', 'page')
    for (const gone of ['updates', 'planning']) await expect(page.getByTestId(`project-tab-${gone}`)).toHaveCount(0)
  })

  test('the primary action follows the tab', async ({ page }) => {
    await open(page, '/projects/1')
    await expect(page.getByTestId('project-header-create')).toContainText('مهمة جديدة')
    await page.getByTestId('project-tab-tasks').click()
    await expect(page).toHaveURL(/\/projects\/1\/tasks/)
    await expect(page.getByTestId('project-header-create')).toContainText('مهمة جديدة')
    await expect(page.getByTestId('project-header-create')).toHaveCount(1)
    await page.getByTestId('project-tab-meetings').click()
    await expect(page.getByTestId('project-meetings-create')).toContainText('اجتماع جديد')
    await expect(page.getByTestId('project-header-create')).toHaveCount(0)
  })

  test('the menu holds settings, copy and archive, and the KPI toggle on the task list', async ({ page }) => {
    await open(page, '/projects/1')
    await openProjectMenu(page)
    for (const name of ['إعدادات المشروع', 'نسخ المشروع', 'أرشفة المشروع']) await expect(page.getByRole('menuitem', { name })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /المؤشرات/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.getByTestId('project-tab-tasks').click()
    await openProjectMenu(page)
    await expect(page.getByRole('menuitem', { name: /المؤشرات/ })).toBeVisible()
  })

  test('archiving asks for confirmation inside the page', async ({ page }) => {
    await open(page, '/projects/1')
    await openProjectMenu(page)
    await page.getByRole('menuitem', { name: 'أرشفة المشروع' }).click()
    const confirm = page.getByTestId('project-archive-confirm')
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'إلغاء' }).click()
    await expect(confirm).toHaveCount(0)
  })

  test('the summary shows the latest update first with the post action', async ({ page }) => {
    await open(page, '/projects/1')
    const latest = page.getByTestId('project-overview-latest-update')
    await expect(latest).toBeVisible()
    await expect(latest.getByTestId('project-updates-create')).toContainText('نشر تحديث')
    const progress = (await page.getByTestId('project-overview-progress').boundingBox())!
    const box = (await latest.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(progress.y + 1)
    await latest.getByTestId('project-updates-create').click()
    await expect(page).toHaveURL(/\/projects\/1\/updates\/new/)
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('the old updates and planning addresses keep working with their query and hash', async ({ page }) => {
    await open(page, '/projects/1/updates?returnTo=%2Fprojects')
    await expect(page).toHaveURL(url => url.pathname === '/projects/1' && url.searchParams.get('returnTo') === '/projects')
    await expect(page.getByTestId('project-tab-summary')).toHaveAttribute('aria-current', 'page')
    await page.goto('/projects/1/planning?scale=month#today')
    await expect(page).toHaveURL(url => url.pathname === '/projects/1/tasks' && url.searchParams.get('view') === 'timeline' && url.searchParams.get('scale') === 'month' && url.hash === '#today')
    await expect(page.getByTestId('project-tab-tasks')).toHaveAttribute('aria-current', 'page')
    await page.goto('/projects/1/schedule')
    await expect(page).toHaveURL(url => url.pathname === '/projects/1/tasks' && url.searchParams.get('view') === 'timeline')
  })
})

test.describe('phone', () => {
  test.use({ viewport: PHONE })

  test('the header wraps without overflow and the five tabs stay on one scrolling line', async ({ page }) => {
    await open(page, '/projects/1')
    await expectFrameOwnsH1(page)
    expect(await fitsWidth(page)).toBe(true)
    const tops = await page.getByTestId('project-workspace-tabs').getByRole('link').evaluateAll(links => links.map(link => Math.round(link.getBoundingClientRect().top)))
    expect(new Set(tops).size).toBe(1)
    await expect(page.getByTestId('project-header-create')).toBeVisible()
    await expect(page.getByTestId('project-workspace-menu')).toBeVisible()
  })
})
