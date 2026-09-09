import { expect, test } from '@playwright/test'

test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Isolated project UI mock only')
test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
})

for (const [path, title] of [
  ['/projects', 'كل المشاريع'], ['/projects?mine=1', 'مشاريعي'],
  ['/projects/1', 'المهام'], ['/projects/1?tab=summary', 'الملخص'],
  ['/projects/1?tab=milestones', 'المعالم'], ['/projects/1/register', 'المخاطر والمشكلات'],
  ['/projects/1/stakeholders', 'أصحاب المصلحة'], ['/projects/1/raci', 'مصفوفة المسؤوليات'],
] as const) {
  test(`clear section heading ${path}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.animate-pulse')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
    await expect(page.locator('.nasq-project-identity')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'البحث والفلاتر', exact: true })).toHaveCount(0)
    await expect(page.getByTestId('projects-list-tabs')).toHaveCount(0)
    await expect(page.locator('[data-slot="page-container"]').getByRole('heading', { name: title, level: 2, exact: true })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('page.png'), fullPage: true })
  })
}

test('risk list shows understandable filters, no one-page pager, and readable text', async ({ page }) => {
  await page.goto('/projects/1/register')
  await expect(page.getByRole('link', { name: 'إضافة خطر أو مشكلة' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'بحث عن خطر أو مشكلة' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'النوع', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'التالي', exact: true })).toHaveCount(0)
  await expect(page.getByRole('columnheader', { name: 'درجة الخطر' })).toBeVisible()
  expect(await page.locator('th').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(13)
  await page.getByRole('textbox', { name: 'بحث عن خطر أو مشكلة' }).fill('اعتماد')
  await expect(page).toHaveURL(/q=/)
  await page.getByRole('link', { name: 'تأخر اعتماد المتطلبات', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('textbox', { name: 'بحث عن خطر أو مشكلة' })).toHaveValue('اعتماد')
})

test('project list uses one create action and retains search between all and my projects', async ({ page }) => {
  await page.goto('/projects?q=alpha')
  await expect(page.getByTestId('project-new')).toBeVisible()
  await expect(page.getByTestId('context-link-new-project')).toHaveCount(0)
  await page.getByTestId('context-link-my-projects').click()
  await expect(page).toHaveURL(/mine=1/)
  await expect(page).toHaveURL(/q=alpha/)
  await page.getByTestId('context-link-projects').click()
  await expect(page).not.toHaveURL(/mine=1/)
  await expect(page).toHaveURL(/q=alpha/)
})

test('stage rename is discoverable by keyboard and Escape preserves the name', async ({ page }) => {
  await page.goto('/projects/1/settings')
  const rename = page.getByRole('button', { name: 'إعادة تسمية', exact: true }).first()
  await expect(rename).toBeEnabled()
  await rename.focus()
  await page.keyboard.press('Enter')
  const input = page.getByRole('textbox', { name: 'إعادة تسمية', exact: true })
  await expect(input).toBeFocused()
  await input.fill('تغيير غير محفوظ')
  await page.keyboard.press('Escape')
  await expect(input).toHaveCount(0)
  await expect(page.getByText('تغيير غير محفوظ', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'اسم المرحلة', exact: true })).toBeVisible()
  await expect(page.getByTestId('project-autosave-status')).toContainText('تُحفظ التغييرات تلقائيًا')
  await page.getByTestId('project-approval-mode').click()
  await page.getByRole('option', { name: 'مستخدم محدد', exact: true }).click()
  await expect(page.getByTestId('project-autosave-status')).toHaveText('اختر المستخدم لإكمال الحفظ.')
  await page.getByTestId('project-approval-cancel').click()
  await expect(page.getByTestId('project-autosave-status')).toContainText('تُحفظ التغييرات تلقائيًا')
})

test('template predecessors use labeled checkboxes without modifier keys', async ({ page }) => {
  await page.goto('/project-templates/new')
  await page.getByRole('button', { name: 'إضافة مهمة', exact: true }).click()
  await page.locator('[name="task-name-0"]').fill('المهمة الأولى')
  await page.getByRole('button', { name: 'إضافة مهمة', exact: true }).click()
  const predecessor = page.getByRole('checkbox', { name: 'المهمة الأولى', exact: true })
  await predecessor.focus()
  await page.keyboard.press('Space')
  await expect(predecessor).toBeChecked()
  await expect(page.locator('select[multiple]')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'اسم المهمة', exact: true })).toHaveCount(2)
})

test('filtered empty state and network failure provide recovery', async ({ page }) => {
  await page.goto('/projects/1/register')
  await expect(page.getByRole('textbox', { name: 'بحث عن خطر أو مشكلة' })).toBeVisible()
  let failed = false
  await page.route('**/api/v1/projects/1/register?*', route => route.fulfill({
    status: failed ? 503 : 200, contentType: 'application/json',
    body: JSON.stringify(failed ? { code: 'unavailable', message: 'Unavailable' } : { items: [], total: 0, can_manage: true }),
  }))
  await page.getByRole('textbox', { name: 'بحث عن خطر أو مشكلة' }).fill('لا يوجد')
  await expect(page.locator('[data-slot="page-container"]').getByRole('status')).toContainText('لا توجد نتائج مطابقة')
  await expect(page.getByRole('button', { name: 'مسح الفلاتر', exact: true })).toBeVisible()
  failed = true
  await page.getByRole('textbox', { name: 'بحث عن خطر أو مشكلة' }).fill('خطأ')
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'إعادة المحاولة', exact: true })).toBeVisible()
})

for (const path of [
  '/projects/dashboard', '/projects/new', '/projects/1/charter', '/projects/1/charter?edit=1',
  '/projects/1/settings', '/projects/1/schedule', '/projects/1/schedule/tasks/101',
  '/projects/1/tasks/new', '/projects/1/tasks/101', '/projects/1/milestones/new', '/projects/1/milestones/1/edit',
  '/projects/1/stakeholders/new', '/projects/1/stakeholders/1', '/projects/1/stakeholders/1/edit',
  '/projects/1/register/new', '/projects/1/register/1', '/projects/1/register/1/edit',
  '/projects/1/finance', '/projects/1/finance/new', '/projects/1/finance/1', '/projects/1/finance/1/edit',
  '/projects/1/updates', '/projects/1/updates/new', '/settings/projects',
  '/settings/projects/catalogs/types', '/settings/projects/catalogs/types/new', '/settings/projects/catalogs/types/1/edit',
  '/project-templates', '/project-templates/new', '/project-templates/1', '/project-templates/1/edit',
]) {
  test(`project page inventory ${path}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.animate-pulse')).toHaveCount(0)
    await expect(page.getByTestId('context-sidebar-toggle')).toBeEnabled()
    const dialog = page.getByRole('dialog')
    const scope = await dialog.count() ? dialog : page.locator('[data-slot="page-container"]').first()
    await expect(scope.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(scope.getByRole('heading', { level: 1 })).toBeVisible()
    const evidence = await scope.evaluate(el => ({
      headings: [...el.querySelectorAll('h1,h2,h3')].map(e => e.textContent),
      controls: [...el.querySelectorAll('input,select,button')].map(e => ({ tag: e.tagName, text: e.textContent, label: e.getAttribute('aria-label') })),
    }))
    await testInfo.attach('page-inventory', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' })
    await page.screenshot({ path: testInfo.outputPath('page.png'), fullPage: true })
  })
}

for (const path of ['/projects', '/projects/1/register', '/projects/1/stakeholders', '/projects/new']) {
  test(`desktop reflow ${path}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.animate-pulse')).toHaveCount(0)
    await expect(page.getByTestId('context-sidebar-toggle')).toBeEnabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.evaluate(() => { document.documentElement.style.zoom = '2' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('zoom-200.png'), fullPage: true })
  })
}
