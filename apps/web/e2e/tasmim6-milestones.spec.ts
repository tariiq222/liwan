import { test, expect } from '@playwright/test'
import { login, open, DESKTOP, PHONE, rows, mobileRows, fitsWidth, expectFrameOwnsH1, typeThenOpen } from './support/tasmim6'

test.describe('Plan 6a: milestones', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: DESKTOP })

    test('the list is the list template inside the frame: one h1, the page create button, a data table', async ({ page }) => {
      await open(page, '/projects/2/milestones')
      await expectFrameOwnsH1(page)
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await expect(page.locator('[data-slot="data-table"]')).toBeVisible()
      await expect(page.getByTestId('milestone-table')).toBeVisible()
      await expect(rows(page)).toHaveCount(3)
      await expect(page.getByTestId('milestone-row')).toHaveCount(3)
      const create = page.getByTestId('project-header-create')
      await expect(create).toHaveAttribute('data-shortcut-create', '')
      await expect(create).toContainText('معلم جديد')
    })

    test('the reached state, an overdue deadline and the checklist', async ({ page }) => {
      await open(page, '/projects/2/milestones')
      const reached = rows(page).filter({ hasText: 'اعتماد الخطة' })
      await expect(reached).toContainText('تم')
      await expect(reached.getByRole('switch')).toHaveCount(0)
      await expect(reached).toContainText('2 من 2')
      const overdue = rows(page).filter({ hasText: 'إطلاق النموذج الأول' })
      await expect(overdue.locator('.text-error')).toHaveCount(1)
      await expect(overdue).toContainText('1 من 3')
    })

    test('J and K move between rows', async ({ page }) => {
      await open(page, '/projects/2/milestones')
      await expect(rows(page)).toHaveCount(3)
      for (const row of await rows(page).all()) await expect(row).toBeVisible()
      await page.getByTestId('project-workspace-name').click()
      await page.keyboard.press('j')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('j')
      await expect(rows(page).nth(1)).toBeFocused()
      await page.keyboard.press('k')
      await expect(rows(page).nth(0)).toBeFocused()
    })

    test('C opens the new-milestone panel over the list and Escape returns to it', async ({ page }) => {
      await open(page, '/projects/2/milestones')
      await page.getByTestId('project-workspace-name').click()
      await page.keyboard.press('c')
      await expect(page).toHaveURL(/\/projects\/2\/milestones\/new\?/)
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await page.keyboard.press('Escape')
      await expect(page).toHaveURL(/\/projects\/2\/milestones$/)
      await expect(page.getByRole('dialog')).toHaveCount(0)
    })

    test('delete asks inline above the table, never in a dialog, and cancel closes it', async ({ page }) => {
      await open(page, '/projects/2/milestones')
      await page.getByRole('button', { name: 'إجراءات المعلم التسليم النهائي' }).click()
      await page.getByRole('menuitem', { name: 'حذف', exact: true }).click()
      const confirm = page.getByTestId('milestone-delete-confirm')
      await expect(confirm).toBeVisible()
      await expect(confirm).toContainText('التسليم النهائي')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await confirm.getByRole('button', { name: 'إلغاء' }).click()
      await expect(confirm).toHaveCount(0)
    })

    test('a milestone with tasks cannot be deleted from its menu', async ({ page }) => {
      await open(page, '/projects/2/milestones')
      await page.getByRole('button', { name: 'إجراءات المعلم إطلاق النموذج الأول' }).click()
      await expect(page.getByRole('menuitem', { name: /حذف \(مرتبط بـ 3 مهام\)/ })).toBeDisabled()
    })

    test('the edit form stays within 58rem at all three root font sizes', async ({ page }) => {
      await open(page, '/projects/2/milestones/13/edit')
      for (const fontSize of [14, 16, 18]) {
        await page.evaluate(value => { document.documentElement.style.fontSize = `${value}px` }, fontSize)
        const metrics = await page.locator('.liwan-page-width-form').last().evaluate(el => ({
          width: el.getBoundingClientRect().width,
          font: parseFloat(getComputedStyle(document.documentElement).fontSize),
          maxWidth: parseFloat(getComputedStyle(el).maxWidth),
        }))
        expect(metrics.maxWidth).toBeCloseTo(metrics.font * 58, 1)
        expect(metrics.width).toBeLessThanOrEqual(metrics.font * 58 + 1)
      }
    })

    test('a viewer who cannot manage sees no create, no actions and no delete', async ({ page }) => {
      await open(page, '/projects/3/milestones')
      await expect(rows(page)).toHaveCount(3)
      await expect(page.getByTestId('project-header-create')).toHaveCount(0)
      await expect(page.getByTestId('milestone-actions')).toHaveCount(0)
      await expect(rows(page).first().getByRole('switch')).toHaveCount(0)
      await rows(page).first().getByRole('link', { name: 'اعتماد الخطة', exact: true }).click()
      await expect(page.getByRole('switch').first()).toBeDisabled()
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: PHONE })
    test('the phone rows carry the same information and J skips the hidden table', async ({ page }) => {
      await open(page, '/projects/2/milestones')
      await expect(mobileRows(page)).toHaveCount(3)
      await expect(page.locator('table')).toBeHidden()
      await expect(page.getByTestId('milestone-card')).toHaveCount(3)
      const first = mobileRows(page).first()
      await expect(first).toContainText('اعتماد الخطة')
      await expect(first).toContainText('تم')
      await expect(first.getByTestId('milestone-actions-card')).toBeVisible()
      expect(await fitsWidth(page)).toBe(true)
      await page.getByTestId('project-workspace-name').click()
      await page.keyboard.press('j')
      await expect(mobileRows(page).nth(0)).toBeFocused()
    })
  })
})
