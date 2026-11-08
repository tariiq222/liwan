import { test, expect, type Page } from '@playwright/test'
import { login, open, DESKTOP, PHONE, fitsWidth } from './support/tasmim6'

// The records of a project (a task and a milestone) are flat workspaces: the whole trail above the heading, one header
// row, no tabs, and plain properties that edit on activation. Mock data: e2e/pmo-ui-preview-data.mjs (project 1, task 101).
const record = (page: Page) => page.locator('[data-template="record-workspace"]')

test.describe('a project record', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: DESKTOP })

    test('the trail names the project and the list, the record has no tabs, and Back stays a link', async ({ page }) => {
      await open(page, '/projects/1/tasks/101')
      const trail = page.getByTestId('page-header-trail')
      await expect(trail).toContainText('المشاريع')
      await expect(trail.getByRole('link', { name: 'مشروع ألفا' })).toHaveAttribute('href', '/projects/1')
      await expect(trail.getByTestId('task-detail-back')).toHaveAttribute('href', /\/projects\/1\/tasks/)
      await expect(trail).toContainText('مهمة جارية')
      await expect(page.getByRole('link', { name: 'العودة إلى المهام' })).toHaveCount(0)
      // No project tabs, no stepper, no section tabs inside the record.
      await expect(page.getByTestId('project-workspace-tabs')).toHaveCount(0)
      await expect(page.getByRole('tab')).toHaveCount(0)
      // No app tile and no generic subtitle on the record.
      await expect(record(page).locator('[data-slot="page-header-chip"]')).toHaveCount(0)
      await expect(record(page).locator('[data-slot="page-header-tagline"]')).toHaveCount(0)
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    })

    test('the title edits in place: a click, Enter saves, Escape reverts', async ({ page }) => {
      await open(page, '/projects/1/tasks/101')
      const heading = page.getByRole('heading', { level: 1 })
      // The title is the button: no pencil icon next to it.
      await expect(heading.locator('.i-lucide-pencil, [class*="lucide-pencil"]')).toHaveCount(0)
      await heading.getByRole('button', { name: /تعديل عنوان المهمة/ }).click()
      const input = page.getByTestId('task-title-input')
      await expect(input).toBeFocused()
      await input.fill('اسم مؤقت')
      await input.press('Escape')
      await expect(input).toHaveCount(0)
      await expect(heading).toContainText('مهمة جارية')
      await expect(heading.getByRole('button')).toBeFocused()

      await heading.getByRole('button', { name: /تعديل عنوان المهمة/ }).click()
      const patched = page.waitForRequest(request => request.method() === 'PATCH' && new URL(request.url()).pathname === '/api/v1/tasks/101')
      await page.getByTestId('task-title-input').fill('مهمة بعنوان جديد')
      await page.getByTestId('task-title-input').press('Enter')
      expect((await patched).postDataJSON()).toEqual({ name: 'مهمة بعنوان جديد' })
    })

    test('the status chip is the status dropdown', async ({ page }) => {
      await open(page, '/projects/1/tasks/101')
      const chip = page.locator('[data-slot="page-header-row"]').getByRole('button', { name: 'قيد التنفيذ' })
      await chip.click()
      await expect(page.getByRole('menuitem').first()).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('menuitem')).toHaveCount(0)
    })

    test('the header row ends with the position, previous/next and the ⋯ menu', async ({ page }) => {
      await open(page, '/projects/1/tasks/101')
      await expect(page.getByTestId('task-position')).toHaveText('1 من 4')
      await expect(page.getByRole('button', { name: 'السابقة' })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'التالية' })).toBeEnabled()
      await page.getByTestId('task-detail-menu').click()
      for (const name of ['نسخ رابط المهمة', 'المرحلة الشخصية', 'أرشفة المهمة']) await expect(page.getByRole('menuitem', { name })).toBeVisible()
    })

    test('the properties read as text and open on activation; no boxed selects, no duplicate stage', async ({ page }) => {
      await open(page, '/projects/1/tasks/101')
      const properties = page.getByTestId('task-properties')
      for (const label of ['المسؤولون', 'الموعد', 'الأولوية', 'المعلم', 'الساعات المخصَّصة', 'الوسوم']) await expect(properties.locator('dt', { hasText: label })).toBeVisible()
      await expect(properties.locator('dt', { hasText: 'المرحلة الشخصية' })).toHaveCount(0)
      // The workflow stage repeats nothing the status chip says, so it appears only when it differs.
      const priority = properties.getByRole('combobox').nth(1)
      await expect(priority).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await priority.click()
      await expect(page.getByRole('option').first()).toBeVisible()
      await page.keyboard.press('Escape')
      // Created, updated and age are one muted line.
      await expect(page.getByTestId('task-record-facts')).toContainText('أُنشئت')
      await expect(page.getByTestId('task-record-facts')).toContainText('العمر')
    })

    test('the description is plain text that edits on click: Escape cancels', async ({ page }) => {
      await open(page, '/projects/1/tasks/101')
      const description = page.getByTestId('task-description')
      // No visible «تعديل» button: the keyboard route is a button that shows only on focus.
      await expect(description.getByTestId('task-description-edit')).toHaveClass(/sr-only/)
      await description.locator('.cursor-text').click()
      await expect(page.getByTestId('task-description-editor')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('task-description-editor')).toHaveCount(0)
      await expect(page).toHaveURL(/\/projects\/1\/tasks\/101$/)
      await expect(description).toContainText('توثيق خطوات العمل')
      await expect(description.getByTestId('task-description-edit')).toBeFocused()
    })

    test('sub-tasks add inline, and an empty attachment or predecessor is a small button', async ({ page }) => {
      await open(page, '/projects/1/tasks/101')
      const subtasks = page.getByTestId('task-subtasks')
      await expect(subtasks.getByRole('heading', { name: /المهام الفرعية/ })).toBeVisible()
      await subtasks.getByTestId('subtask-add').click()
      const input = subtasks.getByTestId('subtask-input')
      await expect(input).toBeFocused()
      await input.press('Escape')
      await expect(input).toHaveCount(0)
      await expect(subtasks.getByTestId('subtask-add')).toBeFocused()
      await expect(page.getByTestId('task-add-attachment')).toHaveText('مرفق')
      await expect(page.getByTestId('task-add-dependency')).toHaveText('تعتمد على مهمة')
      await expect(page.getByTestId('task-attachments')).toHaveCount(0)
      await page.getByTestId('task-add-attachment').click()
      await expect(page.getByTestId('task-attachments')).toBeVisible()
      await expect(page.getByTestId('task-add-attachment')).toHaveCount(0)
    })

    test('the activity is one feed with a filter, and the composer is at the bottom', async ({ page }) => {
      await open(page, '/projects/1/tasks/101')
      const activity = page.getByTestId('task-activity')
      const filter = page.getByTestId('task-activity-filter')
      await expect(filter.getByRole('button', { name: 'الكل', exact: true })).toHaveAttribute('aria-pressed', 'true')
      const feed = activity.getByTestId('task-activity-feed')
      const all = await feed.locator('li').count()
      expect(all).toBeGreaterThan(1)
      await filter.getByRole('button', { name: 'التعليقات', exact: true }).click()
      const comments = await feed.locator('li').count()
      await filter.getByRole('button', { name: 'السجل', exact: true }).click()
      const log = await feed.locator('li').count()
      expect(comments).toBeGreaterThan(0)
      expect(log).toBeGreaterThan(0)
      expect(comments + log).toBe(all)
      await filter.getByRole('button', { name: 'الكل', exact: true }).click()
      const composer = activity.getByPlaceholder(/^اكتب تعليقًا…/)
      await expect(composer).toBeVisible()
      const feedBox = (await feed.boundingBox())!
      const composerBox = (await composer.boundingBox())!
      expect(composerBox.y).toBeGreaterThan(feedBox.y + feedBox.height - 1)
    })

    test('a milestone is the same flat record: trail, inline name, status menu, plain dates', async ({ page }) => {
      await open(page, '/projects/1/milestones/1')
      const trail = page.getByTestId('page-header-trail')
      await expect(trail.getByRole('link', { name: 'مشروع ألفا' })).toHaveAttribute('href', '/projects/1')
      await expect(trail.getByTestId('milestone-detail-back')).toHaveAttribute('href', /\/projects\/1\/milestones/)
      await expect(page.getByRole('tab')).toHaveCount(0)
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByTestId('milestone-state')).toBeVisible()
      await page.getByRole('heading', { level: 1 }).getByRole('button').click()
      await expect(page.getByTestId('milestone-title-input')).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('milestone-properties').locator('dt')).not.toHaveCount(0)
      await page.getByTestId('milestone-detail-menu').click()
      await expect(page.getByRole('menuitem', { name: 'تعديل', exact: true })).toBeVisible()
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: PHONE })
    test('the properties come first, the record fits the screen', async ({ page }) => {
      await open(page, '/projects/1/tasks/101')
      const aside = (await page.locator('[data-slot="record-aside"]').boundingBox())!
      const main = (await page.locator('[data-slot="record-main"]').boundingBox())!
      expect(main.y).toBeGreaterThan(aside.y)
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
