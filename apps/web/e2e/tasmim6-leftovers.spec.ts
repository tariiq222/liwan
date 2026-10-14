import { test, expect } from '@playwright/test'
import { login, open, DESKTOP, PHONE, rows, mobileRows, fitsWidth, expectFrameOwnsH1, typeThenOpen } from './support/tasmim6'

test.describe('Plan 6a: pilot leftovers', () => {
  test.beforeEach(async ({ page }) => { await login(page) })
  test.describe('desktop', () => {
    test.use({ viewport: DESKTOP })
    test('the recent-projects block is a section with a data table and no other table on the dashboard', async ({ page }) => {
      await open(page, '/projects/dashboard')
      await expect(page.locator('#project-dashboard-recent')).toBeVisible()
      await expect(page.locator('[data-slot="data-table"]')).toHaveCount(1)
      await expect(page.getByTestId('recent-project-row')).toHaveCount(3)
      await expect(rows(page)).toHaveCount(3)
    })
    test('the overview shows its loading rows as the shared skeleton', async ({ page }) => {
      await open(page, '/projects')
      let intercepted = false
      let release!: () => void
      const held = new Promise<void>(resolve => { release = resolve })
      await page.route('**/api/v1/tasks?**', async route => { intercepted = true; await held; await route.continue() })
      await page.evaluate(() => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } }).useNuxtApp().$router.push('/projects/1'))
      await expect.poll(() => intercepted).toBe(true)
      await expect(page.getByTestId('project-active-tasks-loading')).toBeVisible()
      await expect(page.getByTestId('project-active-tasks-loading').locator('[data-slot="loading-skeleton"]')).toBeVisible()
      release()
    })
  })
  test.describe('phone', () => {
    test.use({ viewport: PHONE })
    test('the phone rows carry the project, status, progress and update time', async ({ page }) => {
      await open(page, '/projects/dashboard')
      await expect(mobileRows(page)).toHaveCount(3)
      await expect(page.getByTestId('recent-project-card')).toHaveCount(3)
      await expect(page.locator('table')).toBeHidden()
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
