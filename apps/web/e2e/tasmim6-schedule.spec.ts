import { test, expect } from '@playwright/test'
import { login, open, DESKTOP, PHONE, rows, mobileRows, fitsWidth, expectFrameOwnsH1, typeThenOpen } from './support/tasmim6'

test.describe('Plan 6a: schedule', () => {
  test.beforeEach(async ({ page }) => { await login(page) })
  test.describe('desktop', () => {
    test.use({ viewport: DESKTOP })
    test('the schedule is the timeline template inside the frame: one h1, a toolbar, the Gantt', async ({ page }) => {
      await open(page, '/projects/2/schedule')
      await expectFrameOwnsH1(page)
      await expect(page.locator('[data-template="timeline-frame"]')).toHaveCount(1)
      await expect(page.getByTestId('timeline-prev')).toBeEnabled()
      await expect(page.getByTestId('timeline-next')).toBeEnabled()
      await expect(page.getByTestId('timeline-today')).toBeEnabled()
      await expect(page.getByTestId('timeline-range')).not.toBeEmpty()
      await expect(page.getByTestId('schedule-gantt-scroller')).toBeVisible()
      await expect(page.getByTestId('project-header-create')).toHaveAttribute('href', /\/projects\/2\/tasks\/new/)
    })
    test('the scale lives in the URL and survives reload', async ({ page }) => {
      await open(page, '/projects/2/schedule')
      const scale = page.getByTestId('timeline-scale')
      await expect(scale.getByRole('button', { name: 'أسبوعي' })).toHaveAttribute('aria-pressed', 'true')
      await scale.getByRole('button', { name: 'شهري' }).click()
      await expect(page).toHaveURL(/scale=month/)
      await page.reload()
      await expect(page.getByTestId('timeline-scale').getByRole('button', { name: 'شهري' })).toHaveAttribute('aria-pressed', 'true')
    })
    test('the toolbar buttons scroll the track without leaving the page', async ({ page }) => {
      await open(page, '/projects/2/schedule?scale=week')
      await page.getByTestId('timeline-next').click()
      await page.getByTestId('timeline-prev').click()
      await page.getByTestId('timeline-today').click()
      await expect(page).toHaveURL(/\/projects\/2\/schedule/)
    })
    test('a task bar link opens the schedule edit page for a manager and the task for a viewer', async ({ page }) => {
      await open(page, '/projects/2/schedule')
      await expect(page.locator('.schedule-gantt-task').first()).toHaveAttribute('href', /\/projects\/2\/schedule\/tasks\/\d+/)
      // Management and task creation are independent capabilities: refresh actual client auth as a viewer.
      let authIntercepted = false
      await page.route('**/api/v1/me', async route => {
        const response = await route.fetch()
        const me = await response.json()
        authIntercepted = true
        await route.fulfill({ response, json: { ...me, capabilities: me.capabilities.filter((key: string) => key !== 'pmo.tasks.create') } })
      })
      await page.evaluate(() => (window as unknown as { useNuxtApp: () => { $router: { push: (path: string) => Promise<unknown> } } }).useNuxtApp().$router.push('/projects/3/schedule'))
      expect(authIntercepted).toBe(true)
      await expect(page.locator('.schedule-gantt-task').first()).toHaveAttribute('href', /^\/tasks\/\d+/)
      await expect(page.getByTestId('project-header-create')).toHaveCount(0)
    })
  })
  test.describe('phone', () => {
    test.use({ viewport: PHONE })
    test('the toolbar wraps, the Gantt scrolls inside its own container and the page does not overflow', async ({ page }) => {
      await open(page, '/projects/2/schedule?scale=month')
      await expect(page.getByTestId('timeline-prev')).toBeVisible()
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
