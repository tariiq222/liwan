import { test, expect } from '@playwright/test'
import { login, open, DESKTOP, PHONE, rows, mobileRows, fitsWidth, expectFrameOwnsH1, typeThenOpen } from './support/tasmim6'

test.describe('Plan 6a: updates and meetings', () => {
  test.beforeEach(async ({ page }) => { await login(page) })
  test.describe('desktop', () => {
    test.use({ viewport: DESKTOP })
    test('updates is a list page inside the frame: the feed, the page create button, one h1', async ({ page }) => {
      await open(page, '/projects/2/updates')
      await expectFrameOwnsH1(page)
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await expect(page.getByTestId('project-update')).toHaveCount(2)
      const create = page.getByTestId('project-updates-create')
      await expect(create).toHaveAttribute('data-shortcut-create', '')
      await expect(create).toContainText('تحديث جديد')
      await page.getByRole('button', { name: 'عرض المزيد' }).first().click()
      await expect(page.getByRole('button', { name: 'عرض أقل' }).first()).toHaveAttribute('aria-expanded', 'true')
    })
    test('C opens the new-update panel over the feed', async ({ page }) => {
      await open(page, '/projects/2/updates')
      await page.getByTestId('project-workspace-name').click()
      await page.keyboard.press('c')
      await expect(page).toHaveURL(/\/projects\/2\/updates\/new/)
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.getByTestId('project-update')).toHaveCount(2)
    })
    test('a viewer who cannot manage sees no create', async ({ page }) => {
      await open(page, '/projects/3/updates')
      await expect(page.getByTestId('project-update')).toHaveCount(2)
      await expect(page.getByTestId('project-updates-create')).toHaveCount(0)
    })
    test('meetings is a list page with a data table and the page create button', async ({ page }) => {
      await open(page, '/projects/2/meetings')
      await expectFrameOwnsH1(page)
      await expect(page.getByTestId('project-meetings')).toBeVisible()
      await expect(page.locator('[data-slot="data-table"]')).toBeVisible()
      await expect(rows(page)).toHaveCount(1)
      const create = page.getByTestId('project-meetings-create')
      await expect(create).toHaveAttribute('data-shortcut-create', '')
      await expect(create).toContainText('اجتماع جديد')
      await expect(rows(page).first().getByRole('link').first()).toHaveAttribute('href', /\/meetings\/\d+\?.*returnTo=/)
    })
  })
  test.describe('phone', () => {
    test.use({ viewport: PHONE })
    test('the feed and the meeting rows fit a 390px phone', async ({ page }) => {
      await open(page, '/projects/2/updates')
      expect(await fitsWidth(page)).toBe(true)
      await open(page, '/projects/2/meetings')
      await expect(mobileRows(page)).toHaveCount(1)
      await expect(page.locator('table')).toBeHidden()
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
