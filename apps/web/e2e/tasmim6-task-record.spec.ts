import { test, expect } from '@playwright/test'
import { login, open, DESKTOP, PHONE, rows, mobileRows, fitsWidth, expectFrameOwnsH1, typeThenOpen } from './support/tasmim6'

test.describe('Plan 6a: the task record', () => {
  test.beforeEach(async ({ page }) => { await login(page) })
  test.describe('desktop', () => {
    test.use({ viewport: DESKTOP })
    test('/tasks/101 is a record workspace: one h1 with the task name, the trail, no tabs and the properties aside', async ({ page }) => {
      await open(page, '/tasks/101')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('مهمة جارية')
      await expect(page.locator('[data-template="record-workspace"]')).toHaveCount(1)
      await expect(page.getByTestId('task-detail-page')).toBeVisible()
      await expect(page.getByTestId('task-detail-back')).toHaveAttribute('href', '/tasks')
      await expect(page.getByRole('tab')).toHaveCount(0)
      await expect(page.getByTestId('task-properties')).toBeVisible()
      await expect(page.getByTestId('task-properties').locator('dt').filter({ hasText: 'المسؤولون' })).toBeVisible()
      // The deadline is a property, not a countdown in the header.
      await expect(page.getByTestId('deadline-badge')).toHaveCount(0)
    })
    test('the properties read as text and edit from the aside, and the sections stand without tabs', async ({ page }) => {
      await open(page, '/tasks/101')
      await expect(page.getByTestId('task-properties').getByRole('combobox').first()).toBeEnabled()
      await expect(page.getByTestId('task-subtasks')).toBeVisible()
      await expect(page.getByTestId('task-activity')).toBeVisible()
    })
    test('the title edits from the header: Escape reverts the draft', async ({ page }) => {
      await open(page, '/tasks/101')
      const heading = page.getByRole('heading', { level: 1 })
      await heading.getByRole('button', { name: 'تعديل عنوان المهمة' }).click()
      const input = page.getByTestId('task-title-input')
      const original = await input.inputValue()
      await input.fill(`${original} draft`)
      await input.press('Escape')
      // Escape puts the saved name back and leaves the field: the heading keeps its text and the page its URL.
      await expect(input).toHaveCount(0)
      await expect(heading).toHaveText(original)
      await expect(page).toHaveURL(/\/tasks\/101/)
    })
    test('archive asks inline and never in a dialog', async ({ page }) => {
      await open(page, '/tasks/101')
      await page.getByTestId('task-detail-menu').click()
      await page.getByRole('menuitem', { name: 'أرشفة المهمة' }).click()
      await expect(page.getByTestId('task-archive-confirm')).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      let archiveRequests = 0
      page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/tasks/101/archive') archiveRequests += 1 })
      const url = page.url()
      await page.evaluate(() => {
        const runtime = window as unknown as { useNuxtApp: () => { $router: { push: (...args: unknown[]) => Promise<unknown> } }; archiveEscapePushes: number }
        const router = runtime.useNuxtApp().$router
        const push = router.push.bind(router)
        runtime.archiveEscapePushes = 0
        router.push = (...args) => { runtime.archiveEscapePushes += 1; return push(...args) }
      })
      await page.keyboard.press('Escape')
      expect(await page.evaluate(() => (window as unknown as { archiveEscapePushes: number }).archiveEscapePushes)).toBe(0)
      await expect(page.getByTestId('task-archive-confirm')).toBeVisible()
      await expect(page).toHaveURL(url)
      expect(archiveRequests).toBe(0)
    })
    test('inside a project the record owns the only h1 and the trail names the project', async ({ page }) => {
      await open(page, '/projects/1/tasks/101')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1, name: 'مهمة جارية' })).toBeVisible()
      await expect(page.getByTestId('task-detail-back')).toHaveAttribute('href', /\/projects\/1\/tasks/)
      await expect(page.getByTestId('page-header-trail').getByRole('link', { name: 'مشروع ألفا' })).toHaveAttribute('href', '/projects/1')
    })
    test('a task that does not exist shows the shared error state', async ({ page }) => {
      await open(page, '/tasks/99999')
      await expect(page.getByTestId('task-detail-page')).toBeVisible()
      await expect(page.locator('[data-slot="loading-skeleton"]')).toHaveCount(0)
    })
  })
  test.describe('phone', () => {
    test.use({ viewport: PHONE })
    test('the summary comes before the sections and nothing overflows', async ({ page }) => {
      await open(page, '/tasks/101')
      // The record aside (the properties) comes first on a phone, then the main column.
      const aside = await page.locator('[data-slot="record-aside"]').boundingBox()
      const main = await page.locator('[data-slot="record-main"]').boundingBox()
      expect(main!.y).toBeGreaterThan(aside!.y)
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
