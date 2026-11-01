import { expect, test } from '@playwright/test'

test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Isolated project UI mock only')
test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
})

// Outside a project the page title is the h1. Inside one, the project name is the only h1 and the active tab names the section.
for (const [path, title, inProject] of [
  ['/projects', 'كل المشاريع', false], ['/projects?mine=1', 'مشاريعي', false],
  ['/projects/1', 'الملخص', true], ['/projects/1?tab=summary', 'الملخص', true],
  ['/projects/1?tab=milestones', 'المعالم', true], ['/projects/1/register', 'المخاطر والمشكلات', true],
  ['/projects/1/stakeholders', 'أصحاب المصلحة', true], ['/projects/1/raci', 'المسؤوليات RACI', true],
] as const) {
  test(`clear section heading ${path}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.animate-pulse')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    if (inProject) {
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('مشروع ألفا')
      await expect(page.locator('main [aria-current="page"]').filter({ hasText: title })).toBeVisible()
    } else {
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
    }
    await expect(page.locator('.liwan-project-identity')).toHaveCount(0)
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
  // From md the filters sit inline in the list card; the filters button is the phone's way in.
  await expect(page.getByRole('group', { name: 'النوع', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'التالي', exact: true })).toHaveCount(0)
  await expect(page.getByRole('columnheader', { name: 'درجة الخطر' })).toBeVisible()
  expect(await page.locator('th').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12)
  await page.getByRole('textbox', { name: 'بحث عن خطر أو مشكلة' }).fill('اعتماد')
  await expect(page).toHaveURL(/q=/)
  await page.getByRole('link', { name: 'تأخر اعتماد المتطلبات', exact: true }).click()
  // A record is a page, not a dialog.
  await expect(page).toHaveURL(/\/projects\/1\/register\/1/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goBack()
  await expect(page.getByRole('textbox', { name: 'بحث عن خطر أو مشكلة' })).toHaveValue('اعتماد')
})

test('project list uses one create action and the sidebar switches between all and my projects', async ({ page }) => {
  await page.goto('/projects?view=table&q=alpha')
  await expect(page.getByTestId('project-new')).toBeVisible()
  await expect(page.getByTestId('context-link-new-project')).toHaveCount(0)
  await expect(page.getByTestId('context-link-my-projects')).toHaveCount(0)
  // «مشاريعي» is a quick view in the sidebar sub-list. A quick view starts a fresh filter and keeps only the layout (quickViewsModel keepKeys).
  const navigation = page.getByTestId('application-navigation')
  await navigation.getByTestId('projects-quick-view-mine').click()
  await expect(page).toHaveURL(/mine=1/)
  await expect(page).toHaveURL(/view=table/)
  await expect(page).not.toHaveURL(/q=alpha/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('مشاريعي')
  await navigation.getByTestId('projects-context-link-projects-all').click()
  await expect(page).not.toHaveURL(/mine=1/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('كل المشاريع')
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
  await expect(page.locator('[data-slot="error-state"]')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'إعادة المحاولة', exact: true })).toBeVisible()
})

for (const path of [
  '/projects/dashboard', '/projects/new', '/projects/1/charter', '/projects/1/charter?edit=1',
  '/projects/1/settings', '/projects/1/schedule', '/projects/1/schedule/tasks/101',
  '/projects/1/tasks/new', '/projects/1/tasks/101', '/projects/1/milestones/new', '/projects/1/milestones/1/edit',
  '/projects/1/stakeholders/new', '/projects/1/stakeholders/1', '/projects/1/stakeholders/1/edit',
  '/projects/1/register/new', '/projects/1/register/1', '/projects/1/register/1/edit',
  '/projects/1/finance', '/projects/1/finance/new', '/projects/1/finance/1', '/projects/1/finance/1/edit',
  '/projects/1/updates', '/projects/1/updates/new', '/settings/apps/projects',
  '/settings/apps/projects/catalogs/types', '/settings/apps/projects/catalogs/types/new', '/settings/apps/projects/catalogs/types/1/edit',
]) {
  test(`project page inventory ${path}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.animate-pulse')).toHaveCount(0)
    await expect(page.getByTestId('context-sidebar-toggle')).toBeEnabled()
    const dialog = page.getByRole('dialog')
    // The project workspace frame (title row + tabs) precedes the section container since 2026-09-11.
    const scope = await dialog.count() ? dialog : page.locator('[data-slot="page-container"]').filter({ has: page.getByRole('heading', { level: 1 }) }).first()
    if (!await dialog.count()) await expect(page.locator('main h1')).toHaveCount(1)
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
