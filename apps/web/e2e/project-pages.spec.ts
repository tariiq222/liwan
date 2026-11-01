import { expect, test, type Page } from '@playwright/test'
import { expectFrameOwnsH1 } from './support/tasmim6'

// Project routes on the isolated mock: records and edits are pages, /new opens the one create panel, drafts are protected.
// Opt-in local UI fixture only: no production/default port or real database.
test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Requires isolated PROJECTS_UI_PREVIEW mock server')
test.describe.configure({ timeout: 45_000 })

async function login(page: Page) {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.beforeEach(async ({ page }) => { await login(page) })

test('project settings opens as an ordinary page and keeps sidebar navigation', async ({ page }) => {
  await page.goto('/projects/1/tasks?q=تصميم')
  await page.getByTestId('project-workspace-settings').click()
  await expect(page).toHaveURL(/\/projects\/1\/settings/)
  await expect(page.getByRole('heading', { name: 'إعدادات المشروع', level: 2 })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('application-navigation')).not.toHaveAttribute('inert')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'إعدادات المشروع', level: 2 })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('project-workspace-settings')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('project-workspace-tabs').locator('[aria-current="page"]')).toHaveCount(0)
  await page.getByTestId('project-tab-tasks').click()
  await expect(page.getByTestId('project-tab-tasks')).toHaveAttribute('aria-current', 'page')
  expect(new URL(page.url()).searchParams.get('q')).toBe('تصميم')
})

// Inside a project the name is the only h1 and the trail leads back to the list; elsewhere the page title is the h1.
for (const [path, title, inProject] of [
  ['/projects', 'كل المشاريع', false],
  ['/projects?mine=1', 'مشاريعي', false],
  ['/projects/dashboard', 'نظرة عامة', false],
  ['/projects/1?tab=summary', 'مشروع ألفا', true],
  ['/projects/1?tab=milestones', 'مشروع ألفا', true],
  ['/projects/1/schedule', 'مشروع ألفا', true],
  ['/projects/1/raci', 'مشروع ألفا', true],
  ['/projects/1/updates', 'مشروع ألفا', true],
  ['/projects/1/milestones/1/edit', 'مشروع ألفا', true],
  ['/projects/1/stakeholders/1/edit', 'مشروع ألفا', true],
  ['/projects/1/register/1/edit', 'مشروع ألفا', true],
  ['/projects/1/finance/1/edit', 'مشروع ألفا', true],
  ['/projects/1/settings', 'مشروع ألفا', true],
  ['/projects/1/charter?edit=1', 'مشروع ألفا', true],
  ['/settings/apps/projects', 'المشاريع', false],
  ['/settings/apps/projects/catalogs/types', 'أنواع المشاريع', false],
] as const) {
  test(`project hierarchy on ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByTestId('context-project-menu-back')).toHaveCount(0)
    await expect(page.getByTestId('project-workspace-tabs')).toHaveCount(inProject ? 1 : 0)
    // The first line under the name is the way back: «المشاريع», or the list the project was opened from.
    const back = page.locator('[data-testid="project-workspace-trail"], [data-testid="project-workspace-back"]')
    await expect(back).toHaveCount(inProject ? 1 : 0)
    if (inProject) await expect(back).toHaveText('المشاريع')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    if (path === '/projects/1/raci') {
      await expect(page.getByTestId('project-tab-governance')).toHaveAttribute('aria-current', 'page')
      await expect(page.getByTestId('governance-tab-raci')).toHaveAttribute('aria-current', 'page')
    }
  })
}

test('project priority controls fit their cells on a 1024px desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  await page.goto('/projects/1/tasks')
  const priority = page.locator('main td').getByRole('combobox', { name: 'الأولوية', exact: true }).first()
  await expect(priority).toBeEnabled()
  const geometry = await priority.evaluate(element => {
    const control = element.getBoundingClientRect()
    const cell = element.closest('td')!.getBoundingClientRect()
    return { contained: control.x >= cell.x && control.right <= cell.right, width: control.width }
  })
  expect(geometry.contained).toBe(true)
  expect(geometry.width).toBeGreaterThanOrEqual(96)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('desktop project workspace has one identity and one toolbar after a direct reload', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const hydrationErrors: string[] = []
  page.on('console', message => {
    if (/hydration.*mismatch/i.test(message.text())) hydrationErrors.push(message.text())
  })
  await page.goto('/projects/1/tasks?returnTo=%2Fprojects%3Fmine%3D1%26q%3Dalpha&projectListReturnTo=%2Fprojects%3Fmine%3D1%26q%3Dalpha')
  await page.reload()
  await expectFrameOwnsH1(page)
  await expect(page.getByTestId('application-navigation')).toBeVisible()
  await expect(page.getByTestId('project-tab-settings')).toHaveCount(0)
  await expect(page.getByTestId('project-workspace-settings')).toBeVisible()
  await expect(page.locator('[data-slot="skeleton"] h1')).toHaveCount(0)
  expect(hydrationErrors).toEqual([])
  const search = (await page.locator('main [data-shortcut-search] input').boundingBox())!
  const create = (await page.getByTestId('project-header-create').boundingBox())!
  const header = (await page.locator('main [data-slot="page-header"]').boundingBox())!
  expect(create.y).toBeGreaterThanOrEqual(header.y)
  expect(create.y + create.height).toBeLessThanOrEqual(header.y + header.height + 1)
  const title = (await page.getByRole('heading', { level: 1 }).boundingBox())!
  const tabs = (await page.getByTestId('project-workspace-tabs').boundingBox())!
  expect(title.y + title.height).toBeLessThanOrEqual(tabs.y + 1)
  expect(search.y).toBeGreaterThan(tabs.y + tabs.height)
  await page.screenshot({ path: testInfo.outputPath('desktop-project-layout.png'), fullPage: true })
  await expect(page.getByTestId('project-tab-tasks')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('context-link-projects')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('application-navigation').getByRole('heading', { name: 'العمل اليومي' })).toHaveCount(0)
  await expect(page.getByTestId('application-navigation').getByRole('heading', { name: 'متابعة المشروع' })).toHaveCount(0)
  await expect(page.getByTestId('context-link-project-system-settings')).toHaveCount(0)
  await page.getByTestId('project-tab-governance').click()
  await page.getByTestId('governance-tab-stakeholders').click()
  await expect(page.getByTestId('application-navigation')).toBeVisible()
  await expect(page.getByTestId('governance-tab-stakeholders')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('context-project-menu-back')).toHaveCount(0)
  // Only the project overview returns to the list it was opened from; the other sections lead back to «المشاريع».
  await expect(page.getByTestId('project-workspace-trail')).toHaveAttribute('href', '/projects')
  await page.getByTestId('project-tab-summary').click()
  await page.getByTestId('project-workspace-back').click()
  await expect(page).toHaveURL(/\/projects\?mine=1&q=alpha/)
  await expect(page.getByTestId('application-navigation')).toBeVisible()
})

test('desktop sidebar keeps project navigation and collapses independently of the module rail', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/projects/1/tasks?q=مهمة')
  const sidebar = page.getByTestId('application-navigation')
  const toggle = page.getByTestId('context-sidebar-toggle')
  const rail = page.getByTestId('module-rail')
  await expect(toggle).toBeEnabled()
  await expect(sidebar.getByRole('heading', { name: 'المشاريع', exact: true, level: 2 }).first()).toBeVisible()
  await expect(sidebar.getByRole('heading', { name: 'مشروع ألفا', exact: true })).toHaveCount(0)
  await expect(page.getByTestId('project-workspace-name')).toHaveText('مشروع ألفا')
  for (const id of ['project-tab-tasks', 'project-tab-planning', 'project-workspace-settings']) {
    await expect(page.getByTestId(id)).toBeVisible()
  }
  for (const id of ['project-dashboard', 'projects', 'tasks']) {
    await expect(page.getByTestId(`context-link-${id}`)).toBeVisible()
  }
  for (const id of ['my-projects', 'project-system-settings', 'current-project-settings', 'summary', 'stakeholders']) {
    await expect(page.getByTestId(`context-link-${id}`)).toHaveCount(0)
  }
  await expect(page.getByTestId('project-tab-settings')).toHaveCount(0)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(rail).toHaveCSS('width', '76px')
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(64)
  await expect(page.getByTestId('module-rail-toggle')).toHaveCount(0)
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')
  await page.getByTestId('project-workspace-settings').click()
  await expect(page).toHaveURL(/\/projects\/1\/settings/)
  await expect(page.getByRole('heading', { name: 'إعدادات المشروع', level: 2 })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByTestId('project-tab-tasks').click()
  await expect(page.getByTestId('project-tab-tasks')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('main [data-shortcut-search] input')).toHaveValue('مهمة')
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')
  await page.screenshot({ path: testInfo.outputPath('project-sidebar-collapsed.png'), fullPage: true })
  await toggle.click()
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(230)
})

// Only a create route opens the one create panel over its list; records and edits are pages.
for (const path of [
  '/projects/new', '/projects/1/tasks/new', '/projects/1/milestones/new', '/projects/1/stakeholders/new',
  '/projects/1/register/new', '/projects/1/finance/new', '/projects/1/updates/new',
]) {
  test(`direct create route opens exactly one business dialog: ${path}`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('dialog')).not.toContainText('500')
    await page.reload()
    await expect(page.getByRole('dialog')).toHaveCount(1)
  })
}
for (const path of [
  '/projects/1/tasks/101', '/projects/1/milestones/1/edit', '/projects/1/stakeholders/1', '/projects/1/stakeholders/1/edit',
  '/projects/1/register/1', '/projects/1/register/1/edit', '/projects/1/finance/2', '/projects/1/finance/2/edit',
  '/projects/1/schedule/tasks/101', '/projects/1/charter?edit=1',
]) {
  test(`direct record or edit route is a page with no dialog: ${path}`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByTestId('project-workspace-name')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByText('500', { exact: true })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
}

test('default project tasks retain search across Summary and Tasks tabs', async ({ page }) => {
  await page.goto('/projects/1/tasks?q=مهمة&view=board')
  await page.getByTestId('project-tab-summary').click()
  await expect(page.getByTestId('project-tab-summary')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByTestId('project-tab-tasks').click()
  await expect(page.locator('main [data-shortcut-search] input')).toHaveValue('مهمة')
})

test('quick task creation keeps its draft on error and returns to the same list on success', async ({ page }) => {
  let attempts = 0
  const requests: unknown[] = []
  const existing = await page.request.get('/api/v1/tasks/101')
  const detail = await existing.json()
  await page.route('**/api/v1/tasks', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    requests.push(route.request().postDataJSON())
    attempts += 1
    if (attempts === 1) {
      return route.fulfill({ status: 422, json: { code: 'validation_error', message: 'تعذر الحفظ التجريبي، حاول مرة أخرى' } })
    }
    return route.fulfill({ status: 201, json: { ...detail, id: 105, name: 'مهمة جديدة للتجربة' } })
  })
  await page.goto('/projects/1/tasks?q=مهمة')
  await page.getByTestId('project-header-create').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('عنوان المهمة', { exact: true }).fill('مهمة جديدة للتجربة')
  await dialog.getByRole('button', { name: 'إنشاء', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('تعذر الحفظ التجريبي')
  await expect(dialog.getByLabel('عنوان المهمة', { exact: true })).toHaveValue('مهمة جديدة للتجربة')
  await dialog.getByRole('button', { name: 'إنشاء', exact: true }).click()
  // A created task opens as its own page, with the filtered list as its way back.
  await expect(page).toHaveURL(/\/projects\/1\/tasks\/105\?returnTo=/)
  expect(decodeURIComponent(new URL(page.url()).searchParams.get('returnTo') ?? '')).toContain('/projects/1/tasks?q=')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(requests).toEqual([
    { name: 'مهمة جديدة للتجربة', project_id: 1 },
    { name: 'مهمة جديدة للتجربة', project_id: 1 },
  ])
})

test('dirty project task survives Escape and browser back until explicitly discarded', async ({ page }) => {
  await page.goto('/projects/1/tasks')
  await page.getByTestId('project-header-create').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('عنوان المهمة', { exact: true }).fill('مسودة لا تفقد')
  await page.keyboard.press('Escape')
  const confirmation = page.getByTestId('unsaved-changes-dialog')
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'البقاء في الصفحة' }).click()
  await expect(dialog.getByLabel('عنوان المهمة', { exact: true })).toHaveValue('مسودة لا تفقد')
  await page.goBack()
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'المغادرة بدون حفظ' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL(/\/projects\/1\/tasks$/)
})
