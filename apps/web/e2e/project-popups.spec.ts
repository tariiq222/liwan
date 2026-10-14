import { expect, test, type Page } from '@playwright/test'

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
  await page.goto('/projects/1?tab=tasks&q=تصميم')
  await page.getByTestId('project-workspace-settings').click()
  await expect(page).toHaveURL(/\/projects\/1\/settings/)
  await expect(page.getByRole('heading', { name: 'إعدادات المشروع', level: 1 })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('context-sidebar')).not.toHaveAttribute('inert')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'إعدادات المشروع', level: 1 })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByTestId('project-tab-execution').click()
  await expect(page.getByRole('heading', { name: 'المهام', level: 1 })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('q')).toBe('تصميم')
})

for (const [path, current] of [
  ['/projects', 'المشاريع'],
  ['/projects?mine=1', 'مشاريعي'],
  ['/projects/dashboard', 'نظرة عامة'],
  ['/projects/new', 'مشروع جديد'],
  ['/projects/1?tab=summary', 'الملخص'],
  ['/projects/1?tab=milestones', 'المعالم'],
  ['/projects/1/schedule', 'الجدول الزمني'],
  ['/projects/1/raci', 'مصفوفة المسؤوليات'],
  ['/projects/1/updates', 'التحديثات'],
  ['/projects/1/tasks/new', 'إنشاء'],
  ['/projects/1/milestones/1/edit', 'تعديل'],
  ['/projects/1/stakeholders/1/edit', 'تعديل'],
  ['/projects/1/register/1/edit', 'تعديل'],
  ['/projects/1/finance/1/edit', 'تعديل'],
  ['/projects/1/settings', 'إعدادات المشروع'],
  ['/projects/1/charter?edit=1', 'تعديل'],
  ['/projects/settings', 'إعدادات نظام المشاريع'],
  ['/projects/settings/catalogs/types', 'أنواع المشاريع'],
] as const) {
  test(`project hierarchy breadcrumb on ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(path)
    const breadcrumb = page.getByTestId('project-sidebar-breadcrumb')
    await expect(breadcrumb).toBeVisible()
    await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText(current)
    if (path === '/projects/1/raci') {
      await expect(page.getByTestId('project-tab-governance')).toHaveAttribute('data-active', 'true')
      await expect(page.getByTestId('project-subtab-raci')).toHaveAttribute('aria-current', 'page')
    }
    await expect(page.getByTestId('context-project-menu-back')).toHaveCount(0)
    // The sidebar keeps the projects module heading; project sections are in-page tabs (2026-09-11).
    await expect(page.getByTestId('context-sidebar').getByRole('heading', { name: path.startsWith('/settings/') ? 'الإعدادات' : 'المشاريع', level: 2 })).toBeVisible()
    await expect(page.getByTestId('project-workspace-tabs')).toHaveCount(path.startsWith('/projects/1') ? 1 : 0)
  })
}

test('project priority controls fit their cells on a 1024px desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  await page.goto('/projects/1?tab=tasks')
  const priority = page.getByRole('combobox', { name: 'الأولوية', exact: true }).first()
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
  await page.goto('/projects/1?tab=tasks&returnTo=%2Fprojects%3Fmine%3D1%26q%3Dalpha')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'المهام', exact: true, level: 1 })).toBeVisible()
  await expect(page.getByTestId('context-sidebar')).toBeVisible()
  await expect(page.getByTestId('project-tab-settings')).toHaveCount(0)
  await expect(page.getByTestId('project-workspace-settings')).toBeVisible()
  await expect(page.locator('[data-slot="skeleton"] h1')).toHaveCount(0)
  expect(hydrationErrors).toEqual([])
  const filters = page.getByRole('button', { name: /^البحث والفلاتر/ })
  await expect(filters).toHaveAttribute('aria-expanded', 'false')
  await filters.click()
  const search = (await page.getByRole('textbox', { name: 'بحث في العناوين…' }).boundingBox())!
  const create = (await page.getByTestId('project-header-create').boundingBox())!
  const header = (await page.locator('main [data-slot="page-header"]').boundingBox())!
  expect(create.y).toBeGreaterThanOrEqual(header.y)
  expect(create.y + create.height).toBeLessThanOrEqual(header.y + header.height + 1)
  const title = (await page.getByRole('heading', { level: 1 }).boundingBox())!
  const tabs = (await page.getByTestId('project-workspace-tabs').boundingBox())!
  expect(tabs.y + tabs.height).toBeLessThanOrEqual(title.y + 1)
  expect(search.y).toBeGreaterThan(title.y + title.height)
  await page.screenshot({ path: testInfo.outputPath('desktop-project-layout.png'), fullPage: true })
  await expect(page.getByRole('link', { name: 'العودة إلى المشاريع', exact: true })).toHaveCount(0)
  await expect(page.getByTestId('project-tab-execution')).toHaveAttribute('data-active', 'true')
  await expect(page.getByTestId('project-subtab-tasks')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('context-link-projects')).toHaveAttribute('aria-current', 'page')
  const breadcrumb = page.getByTestId('project-sidebar-breadcrumb')
  await expect(breadcrumb).toContainText('المشاريع')
  await expect(breadcrumb).toContainText('مشروع ألفا')
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText('المهام')
  await expect(page.getByTestId('project-tab-overview')).not.toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('context-sidebar').getByRole('heading', { name: 'المشاريع', level: 2 })).toBeVisible()
  await expect(page.getByTestId('context-sidebar').getByRole('heading', { name: 'العمل اليومي' })).toHaveCount(0)
  await expect(page.getByTestId('context-sidebar').getByRole('heading', { name: 'متابعة المشروع' })).toHaveCount(0)
  await expect(page.getByTestId('context-link-project-system-settings')).toHaveCount(0)
  await page.getByTestId('project-tab-governance').click()
  await expect(page.getByRole('heading', { name: 'ملف المشروع', level: 1 })).toBeVisible()
  await page.getByTestId('project-subtab-stakeholders').click()
  await expect(page.getByTestId('context-sidebar')).toBeVisible()
  await expect(page.getByRole('link', { name: 'العودة إلى المشاريع', exact: true })).toHaveCount(0)
  await expect(page.getByTestId('project-subtab-stakeholders')).toHaveAttribute('aria-current', 'page')
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText('أصحاب المصلحة')
  await expect(page.getByTestId('context-project-menu-back')).toHaveCount(0)
  await breadcrumb.getByRole('link', { name: 'مشروع ألفا', exact: true }).click()
  await expect(page).toHaveURL(/tab=summary/)
  await breadcrumb.getByRole('link', { name: 'المشاريع', exact: true }).click()
  await expect(page).toHaveURL(/\/projects\?mine=1&q=alpha/)
  await expect(page.getByTestId('context-link-project-system-settings')).toHaveCount(0)
  await expect(page.getByTestId('context-link-project-templates')).toHaveText('قوالب المشاريع')
  await expect(page.getByTestId('context-sidebar')).toBeVisible()
})

test('desktop sidebar keeps project navigation and collapses independently of the module rail', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/projects/1?tab=tasks&q=مهمة')
  const sidebar = page.getByTestId('context-sidebar')
  const toggle = page.getByTestId('context-sidebar-toggle')
  const rail = page.getByTestId('module-rail')
  await expect(toggle).toBeEnabled()
  await expect(sidebar.getByRole('heading', { name: 'المشاريع', exact: true, level: 2 })).toBeVisible()
  await expect(sidebar.getByRole('heading', { name: 'مشروع ألفا', exact: true })).toHaveCount(0)
  await expect(page.getByTestId('project-workspace-name')).toHaveText('مشروع ألفا')
  for (const id of ['subtab-tasks', 'subtab-milestones', 'workspace-settings']) {
    await expect(page.getByTestId(`project-${id}`)).toBeVisible()
  }
  for (const id of ['new-project', 'project-dashboard', 'projects', 'tasks', 'project-templates']) {
    await expect(page.getByTestId(`context-link-${id}`)).toBeVisible()
  }
  for (const id of ['my-projects', 'project-system-settings', 'current-project-settings', 'summary', 'stakeholders']) {
    await expect(page.getByTestId(`context-link-${id}`)).toHaveCount(0)
  }
  await expect(page.getByTestId('project-tab-settings')).toHaveCount(0)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(rail).toHaveCSS('width', '64px')
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(48)
  await expect(page.getByTestId('module-rail-toggle')).toHaveCount(0)
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')
  await page.getByTestId('project-workspace-settings').click()
  await expect(page).toHaveURL(/\/projects\/1\/settings/)
  await expect(page.getByRole('heading', { name: 'إعدادات المشروع', level: 1 })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByTestId('project-tab-execution').click()
  await expect(page.getByRole('heading', { name: 'المهام', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: /^البحث والفلاتر/ }).click()
  await expect(page.getByRole('textbox', { name: 'بحث في العناوين…' })).toHaveValue('مهمة')
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')
  await page.screenshot({ path: testInfo.outputPath('project-sidebar-collapsed.png'), fullPage: true })
  await toggle.click()
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(232)
})

test('task opens over project and browser back returns to the filtered workspace', async ({ page }) => {
  await page.goto('/projects/1?tab=tasks&q=مهمة')
  const task = page.getByRole('button', { name: 'مهمة جارية', exact: true })
  await expect(task).toBeVisible()
  await page.getByRole('button', { name: /^البحث والفلاتر/ }).click()
  const originalWorkspace = await page.getByRole('textbox', { name: 'بحث في العناوين…' }).elementHandle()
  await task.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('مهمة جارية')
  await expect(page.getByTestId('project-sidebar-breadcrumb').locator('[aria-current="page"]')).toHaveText('التفاصيل')
  await expect(page).toHaveURL(/\/projects\/1\/tasks\/101/)
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByPlaceholder('بحث في العناوين…')).toHaveValue('مهمة')
  await expect(task).toBeVisible()
  expect(await originalWorkspace!.evaluate(element => element.isConnected)).toBe(true)
  await expect(task).toBeFocused()
})

for (const path of [
  '/projects/new', '/projects/1/tasks/new', '/projects/1/tasks/101',
  '/projects/1/milestones/new', '/projects/1/milestones/1/edit',
  '/projects/1/stakeholders/new', '/projects/1/stakeholders/1', '/projects/1/stakeholders/1/edit',
  '/projects/1/register/new', '/projects/1/register/1', '/projects/1/register/1/edit',
  '/projects/1/finance/new', '/projects/1/finance/2', '/projects/1/finance/2/edit',
  '/projects/1/updates/new', '/projects/1/schedule/tasks/101',
  '/projects/1/charter?edit=1',
  '/project-templates/1', '/project-templates/new', '/project-templates/1/edit', '/project-templates/1/apply',
]) {
  test(`direct route opens exactly one business dialog: ${path}`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('dialog')).not.toContainText('500')
    await page.reload()
    await expect(page.getByRole('dialog')).toHaveCount(1)
  })
}

test('direct settings route remains a standalone page after refresh', async ({ page }) => {
  await page.goto('/projects/1/settings')
  await expect(page.getByRole('heading', { name: 'إعدادات المشروع', level: 1 })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'إعدادات المشروع', level: 1 })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('project-workspace-settings')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('project-workspace-tabs').locator('[aria-current="page"]')).toHaveCount(0)
})

test('non-project task details use the approved shared sheet with a full-page option', async ({ page }) => {
  await page.goto('/tasks/101')
  await expect(page.getByTestId('task-detail-page')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await page.goto('/tasks/101?fullPage=1')
  await expect(page.getByTestId('task-detail-page')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('default project tasks retain search across Summary and Tasks tabs', async ({ page }) => {
  await page.goto('/projects/1?q=مهمة&view=board')
  await page.getByTestId('project-tab-overview').click()
  await expect(page.getByTestId('project-tab-overview')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('project-workspace-subtabs')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByTestId('project-tab-execution').click()
  await expect(page.getByPlaceholder('بحث في العناوين…')).toHaveValue('مهمة')
})

test('standalone option remains available', async ({ page }) => {
  await page.goto('/projects/1/tasks/101?fullPage=1')
  await expect(page.getByTestId('task-detail-page')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('RTL side sheet enters from the left and remains mounted until it exits right', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/projects/1?tab=tasks')
  await page.evaluate(() => {
    const events: Array<{ type: string; state: string | null; x: number; right: number; translateX: number }> = []
    ;(window as any).__projectSheetMotion = events
    for (const type of ['animationstart', 'animationend']) {
      document.addEventListener(type, (event) => {
        const target = event.target
        if (!(event instanceof AnimationEvent)
          || !(target instanceof HTMLElement) || target.getAttribute('role') !== 'dialog') return
        const rect = target.getBoundingClientRect()
        events.push({ type, state: target.getAttribute('data-state'), x: rect.x,
          right: rect.right, translateX: new DOMMatrix(getComputedStyle(target).transform).m41 })
        if (type === 'animationstart') {
          const sample = () => {
            if (!target.isConnected) return
            const bounds = target.getBoundingClientRect()
            events.push({ type: 'sample', state: target.getAttribute('data-state'),
              x: bounds.x, right: bounds.right, translateX: new DOMMatrix(getComputedStyle(target).transform).m41 })
            requestAnimationFrame(sample)
          }
          requestAnimationFrame(sample)
        }
      }, true)
    }
  })
  await page.getByTestId('project-header-create').click()
  await expect.poll(() => page.evaluate(() => (window as any).__projectSheetMotion.some(
    (event: any) => event.type === 'animationend' && event.state === 'open',
  ))).toBe(true)
  const entryEvents = await page.evaluate(() => (window as any).__projectSheetMotion)
  expect(entryEvents.some((event: any) => event.type === 'animationstart' && event.state === 'open' && event.translateX < 0)).toBe(true)
  await page.evaluate(() => { (window as any).__projectSheetMotion.length = 0 })
  await page.getByTestId('project-overlay-close').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const events = await page.evaluate(() => (window as any).__projectSheetMotion)
  // Vue may remove the leaving node on its timeout just before the browser's
  // last transitionend frame. Sample actual visible travel while still mounted.
  expect(events.some((event: any) => event.type === 'sample' && event.translateX > 0), JSON.stringify(events)).toBe(true)
})

test('project sheets remove redundant back navigation and retain the shell corner', async ({ page }) => {
  await page.goto('/projects/1/tasks/new')
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('link', { name: 'العودة إلى المشروع', exact: true })).toHaveCount(0)
  const corner = await sheet.evaluate(element => getComputedStyle(element).borderStartStartRadius)
  expect(parseFloat(corner)).toBeGreaterThan(0)
  await page.getByTestId('project-overlay-full-page').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'العودة إلى المشروع', exact: true })).toBeVisible()
})

test('side sheet respects reduced motion and follows the expanded module rail', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/projects/1/tasks/new')
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await expect.poll(async () => {
    const overlay = (await page.getByTestId('project-route-overlay').boundingBox())!
    const rail = (await page.getByTestId('module-rail').boundingBox())!
    const bounds = (await sheet.boundingBox())!
    return Math.abs(overlay.x + overlay.width - rail.x) <= 1 && Math.abs(bounds.x - overlay.x) <= 1
  }).toBeTruthy()
  await page.getByTestId('project-overlay-close').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('project-header-create')).toBeEnabled()
})

test('risk details and editing share one window over the same register', async ({ page }) => {
  await page.goto('/projects/1/register')
  await page.getByRole('link', { name: 'تأخر اعتماد المتطلبات', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await page.getByTestId('register-detail-edit').click()
  await expect(page).toHaveURL(/\/register\/1\/edit/)
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await page.getByTestId('project-overlay-close').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL(/\/projects\/1\/register$/)
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
  await page.goto('/projects/1?tab=tasks&q=مهمة')
  await page.getByRole('link', { name: 'مهمة جديدة', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByTestId('task-create-optional')).not.toHaveAttribute('open', '')
  await dialog.getByLabel('عنوان المهمة', { exact: true }).fill('مهمة جديدة للتجربة')
  await dialog.getByRole('button', { name: 'إنشاء', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('تعذر الحفظ التجريبي')
  await expect(dialog.getByLabel('عنوان المهمة', { exact: true })).toHaveValue('مهمة جديدة للتجربة')
  await dialog.getByRole('button', { name: 'إنشاء', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByPlaceholder('بحث في العناوين…')).toHaveValue('مهمة')
  expect(requests).toEqual([
    { name: 'مهمة جديدة للتجربة', project_id: 1 },
    { name: 'مهمة جديدة للتجربة', project_id: 1 },
  ])
})

test('opening the full page guards a dirty popup draft', async ({ page }) => {
  await page.goto('/projects/1/tasks/new')
  await page.getByRole('dialog').getByLabel('عنوان المهمة', { exact: true }).fill('مسودة قبل التوسيع')
  await page.getByTestId('project-overlay-full-page').click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('alertdialog').getByRole('button', { name: 'البقاء في الصفحة' }).click()
  await expect(page.getByRole('dialog').getByLabel('عنوان المهمة', { exact: true })).toHaveValue('مسودة قبل التوسيع')
  await page.getByTestId('project-overlay-full-page').click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'المغادرة بدون حفظ' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL(/fullPage=1/)
  await expect(page.getByLabel('عنوان المهمة', { exact: true })).toHaveValue('')
})

test('returning from full page to popup protects the full-page draft', async ({ page }) => {
  await page.goto('/projects/1/tasks/new')
  await page.getByTestId('project-overlay-full-page').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByLabel('عنوان المهمة', { exact: true }).fill('مسودة العرض الكامل')
  await page.goBack()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('alertdialog').getByRole('button', { name: 'البقاء في الصفحة' }).click()
  await expect(page.getByLabel('عنوان المهمة', { exact: true })).toHaveValue('مسودة العرض الكامل')
  await expect(page).toHaveURL(/fullPage=1/)
})

test('shell navigation remains available and protects a dirty project draft', async ({ page }) => {
  await page.goto('/projects/1/tasks/new')
  await page.getByRole('dialog').getByLabel('عنوان المهمة', { exact: true }).fill('مسودة قبل تغيير الموديول')
  // «مهامي» lives in the projects sidebar since 2026-09-11; the rail keeps the modules.
  const moduleNavigation = page.getByTestId('context-sidebar')
  await moduleNavigation.getByRole('link', { name: 'مهامي', exact: true }).click()
  const confirmation = page.getByRole('alertdialog')
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'البقاء في الصفحة' }).click()
  await expect(page.getByRole('dialog').getByLabel('عنوان المهمة', { exact: true })).toHaveValue('مسودة قبل تغيير الموديول')
  await moduleNavigation.getByRole('link', { name: 'مهامي', exact: true }).click()
  await confirmation.getByRole('button', { name: 'المغادرة بدون حفظ' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('dirty project task survives Escape and browser back until explicitly discarded', async ({ page }) => {
  await page.goto('/projects/1?tab=tasks')
  await page.getByTestId('project-header-create').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('عنوان المهمة', { exact: true }).fill('مسودة لا تفقد')
  await page.keyboard.press('Escape')
  const confirmation = page.getByRole('alertdialog')
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'البقاء في الصفحة' }).click()
  await expect(dialog.getByLabel('عنوان المهمة', { exact: true })).toHaveValue('مسودة لا تفقد')
  await page.goBack()
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'المغادرة بدون حفظ' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL(/\/projects\/1\?tab=tasks$/)
})

for (const width of [390, 700, 768, 1440]) {
  test(`project side sheet aligns with the main module rail and fills available height at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/projects/1/tasks/new')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect.poll(async () => {
      const box = (await dialog.boundingBox())!
      const rail = (await page.getByTestId('module-rail').boundingBox())!
      const header = (await page.getByTestId('shell-header').boundingBox())!
      const top = Math.max(0, header.y + header.height)
      const overlay = (await page.getByTestId('project-route-overlay').boundingBox())!
      return Math.abs(box.y - top) <= 1
        && Math.abs(box.x - overlay.x) <= 1
        && Math.abs(overlay.x + overlay.width - rail.x) <= 1
        && Math.abs(box.y + box.height - 844) <= 1
    }).toBe(true)
    await expect(page.getByRole('banner', { name: 'رأس التطبيق' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'الموديولات', exact: true })).toBeVisible()
    const save = dialog.getByRole('button', { name: 'إنشاء', exact: true })
    await save.scrollIntoViewIfNeeded()
    await expect(save).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}
