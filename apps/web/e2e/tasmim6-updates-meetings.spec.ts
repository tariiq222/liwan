import { test, expect } from '@playwright/test'
import { login, open, DESKTOP, PHONE, rows, mobileRows, fitsWidth, expectFrameOwnsH1, typeThenOpen } from './support/tasmim6'

test.describe('Plan 6a: updates in the summary and meetings', () => {
  test.beforeEach(async ({ page }) => { await login(page) })
  test.describe('desktop', () => {
    test.use({ viewport: DESKTOP })
    test('the summary shows the latest update with its post action and the earlier ones below', async ({ page }) => {
      await open(page, '/projects/2')
      await expectFrameOwnsH1(page)
      await expect(page.getByTestId('project-overview-latest-update')).toBeVisible()
      await expect(page.getByTestId('project-update')).toHaveCount(1)
      const post = page.getByTestId('project-updates-create')
      await expect(post).toContainText('نشر تحديث')
      // The feed lists the earlier update; the latest is the panel above it, shown in full.
      await expect(page.getByTestId('project-overview-latest-update').getByTestId('project-update')).toHaveCount(0)
    })
    test('posting opens the new-update panel over the summary and Escape returns to it', async ({ page }) => {
      await open(page, '/projects/2')
      await page.getByTestId('project-updates-create').click()
      await expect(page).toHaveURL(/\/projects\/2\/updates\/new/)
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.getByTestId('project-overview-latest-update')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page).toHaveURL(url => url.pathname === '/projects/2')
    })
    test('the old updates address opens the summary', async ({ page }) => {
      await open(page, '/projects/2/updates?returnTo=%2Fprojects')
      await expect(page).toHaveURL(url => url.pathname === '/projects/2' && url.searchParams.get('returnTo') === '/projects')
      await expect(page.getByTestId('project-overview-latest-update')).toBeVisible()
    })
    test('a viewer who cannot manage sees the updates and no post action', async ({ page }) => {
      await open(page, '/projects/3')
      await expect(page.getByTestId('project-overview-latest-update')).toBeVisible()
      await expect(page.getByTestId('project-update')).toHaveCount(1)
      await expect(page.getByTestId('project-updates-create')).toHaveCount(0)
    })
    test('meetings is a list page with a data table and the page create button', async ({ page }) => {
      await open(page, '/projects/2/meetings')
      await expectFrameOwnsH1(page)
      await expect(page.getByTestId('project-meetings')).toBeVisible()
      await expect(page.locator('[data-slot="data-table"]')).toBeVisible()
      await expect(rows(page)).toHaveCount(5)
      // The frame header draws the button; the list below has no action row.
      const create = page.getByTestId('project-workspace-frame').getByTestId('project-meetings-create')
      await expect(create).toHaveAttribute('data-shortcut-create', '')
      await expect(create).toContainText('اجتماع جديد')
      await expect(rows(page).first().getByRole('link').first()).toHaveAttribute('href', /\/meetings\/\d+\?.*returnTo=/)
    })
  })
  test.describe('phone', () => {
    test.use({ viewport: PHONE })
    test('the summary feed and the meeting rows fit a 390px phone', async ({ page }) => {
      await open(page, '/projects/2')
      expect(await fitsWidth(page)).toBe(true)
      await open(page, '/projects/2/meetings')
      await expect(mobileRows(page)).toHaveCount(5)
      await expect(page.locator('table')).toBeHidden()
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
