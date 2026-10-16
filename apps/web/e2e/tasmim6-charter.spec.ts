import { test, expect } from '@playwright/test'
import { login, open, DESKTOP, PHONE, rows, mobileRows, fitsWidth, expectFrameOwnsH1, typeThenOpen } from './support/tasmim6'

test.describe('Plan 6a: the project file', () => {
  test.beforeEach(async ({ page }) => { await login(page) })
  test.describe('desktop', () => {
    test.use({ viewport: DESKTOP })
    test('the read view is a print page inside the frame with the state badge and the edit button', async ({ page }) => {
      await open(page, '/projects/2/charter')
      await expectFrameOwnsH1(page)
      await expect(page.locator('[data-template="standalone-page"][data-variant="print"]')).toHaveCount(1)
      await expect(page.getByTestId('charter-state-badge')).toBeVisible()
      await expect(page.getByTestId('project-charter-display')).toBeVisible()
      await expect(page.getByTestId('project-charter-edit')).toBeVisible()
      await expect(page.getByTestId('project-charter-print')).toBeEnabled()
    })
    test('on paper the shell chrome and the frame are gone and the file is black on white', async ({ page }) => {
      await open(page, '/projects/2/charter')
      await page.emulateMedia({ media: 'print' })
      await expect(page.locator('.webvue-shell-header')).toBeHidden()
      await expect(page.getByTestId('project-workspace-frame')).toBeHidden()
      await expect(page.getByTestId('project-charter-display')).toBeVisible()
      const color = await page.getByTestId('project-charter-display').evaluate(el => getComputedStyle(el).color)
      expect(color).toBe('rgb(0, 0, 0)')
    })
    test('edit mode is a form page and a viewer has no edit button', async ({ page }) => {
      await open(page, '/projects/2/charter?edit=1')
      await expect(page.getByTestId('project-charter-wizard')).toBeVisible()
      await expect(page.locator('[data-variant="print"]')).toHaveCount(0)
      await open(page, '/projects/3/charter')
      await expect(page.getByTestId('project-charter-edit')).toHaveCount(0)
    })
    test('the new-project panel opens over the projects list', async ({ page }) => {
      await open(page, '/projects')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('c')
      await expect(page).toHaveURL(/\/projects\/new/)
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
    })
  })
  test.describe('phone', () => {
    test.use({ viewport: PHONE })
    test('the file fits a 390px phone', async ({ page }) => {
      await open(page, '/projects/2/charter')
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
