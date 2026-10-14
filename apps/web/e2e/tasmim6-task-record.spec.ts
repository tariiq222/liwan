import { test, expect } from '@playwright/test'
import { login, open, DESKTOP, PHONE, rows, mobileRows, fitsWidth, expectFrameOwnsH1, typeThenOpen } from './support/tasmim6'

test.describe('Plan 6a: the task record', () => {
  test.beforeEach(async ({ page }) => { await login(page) })
  test.describe('desktop', () => {
    test.use({ viewport: DESKTOP })
    test('/tasks/101 is a record page: one h1 with the task name, the back control, the tabs and the properties aside', async ({ page }) => {
      await open(page, '/tasks/101')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('مهمة جارية')
      await expect(page.locator('[data-template="record"]')).toHaveCount(1)
      await expect(page.getByTestId('task-detail-page')).toBeVisible()
      await expect(page.getByTestId('task-detail-back')).toHaveAttribute('href', '/tasks')
      await expect(page.getByTestId('task-detail-tabs')).toBeVisible()
      await expect(page.getByTestId('task-properties')).toBeVisible()
      await expect(page.getByTestId('task-properties').locator('dt').filter({ hasText: 'المسؤولون' })).toBeVisible()
      await expect(page.getByTestId('deadline-badge')).toBeVisible()
    })
    test('the editors work from the aside without opening a tab, and the tabs keep their sections', async ({ page }) => {
      await open(page, '/tasks/101')
      await expect(page.getByTestId('task-properties').getByRole('combobox').first()).toBeEnabled()
      const tabs = page.getByTestId('task-detail-tabs')
      for (const name of ['التفاصيل', 'المهام الفرعية', 'المرفقات']) await expect(tabs.getByRole('tab', { name, exact: true })).toBeVisible()
      await tabs.getByRole('tab', { name: 'المهام الفرعية', exact: true }).click()
      await expect(page.getByTestId('task-properties')).toBeVisible()
    })
    test('the title edits in place: Escape cancels and the heading returns', async ({ page }) => {
      await open(page, '/tasks/101')
      await page.getByTestId('task-title-edit').click()
      await expect(page.getByTestId('task-title-input')).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('task-title-input')).toHaveCount(0)
      await expect(page).toHaveURL(/\/tasks\/101/)
    })
    test('archive asks inline and never in a dialog', async ({ page }) => {
      await open(page, '/tasks/101')
      await page.getByTestId('task-archive').click()
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
    test('inside a project the frame keeps the only h1 and the task name is an h2', async ({ page }) => {
      await open(page, '/projects/1/tasks/101')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 2, name: 'مهمة جارية' })).toBeVisible()
      await expect(page.getByTestId('task-detail-back')).toHaveAttribute('href', /\/projects\/1\/tasks/)
    })
    test('a task that does not exist shows the shared error state', async ({ page }) => {
      await open(page, '/tasks/99999')
      await expect(page.getByTestId('task-detail-page')).toBeVisible()
      await expect(page.locator('[data-slot="loading-skeleton"]')).toHaveCount(0)
    })
  })
  test.describe('phone', () => {
    test.use({ viewport: PHONE })
    test('the aside follows the main column and nothing overflows', async ({ page }) => {
      await open(page, '/tasks/101')
      const main = await page.locator('[data-slot="record-main"]').boundingBox()
      const aside = await page.locator('[data-slot="record-aside"]').boundingBox()
      expect(aside!.y).toBeGreaterThan(main!.y)
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
