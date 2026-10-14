import { test, expect } from '@playwright/test'
import { login, open, DESKTOP, PHONE, rows, mobileRows, fitsWidth, expectFrameOwnsH1, typeThenOpen } from './support/tasmim6'

test.describe('Plan 6a: RACI', () => {
  test.beforeEach(async ({ page }) => { await login(page) })
  test.describe('desktop', () => {
    test.use({ viewport: DESKTOP })
    test('the page is a list page inside the frame with filters, a legend section and the matrix', async ({ page }) => {
      await open(page, '/projects/2/raci')
      await expectFrameOwnsH1(page)
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await expect(page.getByTestId('raci-closed-scope')).toBeVisible()
      await expect(page.getByRole('heading', { level: 2, name: 'دليل مصفوفة المسؤوليات' })).toBeVisible()
      await expect(page.getByRole('table')).toBeVisible()
      await expect(page.locator('[data-testid="raci-cell"]')).not.toHaveCount(0)
      await expect(page.locator('[data-shortcut-row]')).toHaveCount(0)
    })
    test('a role cell is a select for a manager and a badge for a viewer', async ({ page }) => {
      await open(page, '/projects/2/raci')
      await expect(page.getByRole('combobox').first()).toBeVisible()
      await open(page, '/projects/3/raci')
      await expect(page.getByRole('combobox')).toHaveCount(0)
    })
    test('stale task and stakeholder pages keep their independent Previous controls', async ({ page }) => {
      await open(page, '/projects/2/raci?task_page=1&stakeholder_page=1')
      const pagination = page.getByTestId('shared-pagination')
      await expect(pagination).toHaveCount(2)
      await expect(pagination.nth(0).locator('button[data-slot="prev"]')).toBeEnabled()
      await expect(pagination.nth(1).locator('button[data-slot="prev"]')).toBeEnabled()
      await pagination.nth(0).locator('button[data-slot="prev"]').click()
      await expect.poll(() => new URL(page.url()).searchParams.get('task_page')).toBe('0')
      expect(new URL(page.url()).searchParams.get('stakeholder_page')).toBe('1')
      await expect(pagination).toHaveCount(1)
      await pagination.locator('button[data-slot="prev"]').click()
      await expect.poll(() => new URL(page.url()).searchParams.get('stakeholder_page')).toBe('0')
      expect(new URL(page.url()).searchParams.get('task_page')).toBe('0')
      await expect(pagination).toHaveCount(0)
      await expect(page.getByTestId('raci-cell')).not.toHaveCount(0)
    })

    test('clearing a role asks inline and never in a dialog', async ({ page }) => {
      await open(page, '/projects/2/raci')
      await page.getByRole('combobox').first().click()
      await page.getByRole('option', { name: '—' }).click()
      await expect(page.getByTestId('raci-delete-confirm')).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.getByTestId('raci-delete-confirm').getByRole('button', { name: 'إلغاء' }).click()
      await expect(page.getByTestId('raci-delete-confirm')).toHaveCount(0)
    })
  })
  test.describe('phone', () => {
    test.use({ viewport: PHONE })
    test('the matrix scrolls inside its own container and the page does not overflow', async ({ page }) => {
      await open(page, '/projects/2/raci')
      await expect(page.getByTestId('raci-matrix')).toBeVisible()
      expect(await fitsWidth(page)).toBe(true)
      expect(await page.getByTestId('raci-matrix').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
    })
  })
})
