import { test, expect } from '@playwright/test'
import { login, open, DESKTOP, PHONE, rows, mobileRows, fitsWidth, expectFrameOwnsH1, typeThenOpen } from './support/tasmim6'

test.describe('Plan 6a: project templates', () => {
  test.beforeEach(async ({ page }) => { await login(page) })
  test.describe('desktop', () => {
    test.use({ viewport: DESKTOP })
    test('the list is the list template with a table and the page create button', async ({ page }) => {
      await open(page, '/projects/templates')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('قوالب المشاريع')
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await expect(rows(page)).toHaveCount(3)
      const create = page.locator('[data-shortcut-create]')
      await expect(create).toContainText('قالب جديد')
      await expect(rows(page).first().getByRole('link', { name: 'إطلاق خدمة' })).toHaveAttribute('href', '/projects/templates/1')
    })
    test('J, K and Enter open the focused template; C opens the new-template panel over the list', async ({ page }) => {
      await open(page, '/projects/templates')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/projects\/templates\/1/)
      await open(page, '/projects/templates')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('c')
      await expect(page).toHaveURL(/\/projects\/templates\/new/)
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
    })
    test('a row opened right after typing keeps the search in its return path', async ({ page }) => {
      await open(page, '/projects/templates')
      await page.route('**/api/v1/me', async route => {
        await new Promise(resolve => setTimeout(resolve, 400))
        await route.continue()
      })
      await typeThenOpen(page, { search: 'تنفيذ', link: 'tbody tr[data-shortcut-row] a' })
      await expect(page).toHaveURL(/\/projects\/templates\/\d+/)
      expect(new URL(page.url()).searchParams.get('q')).toBe('تنفيذ')
    })
    test('the record is a record page: stages, milestones and tasks as sections, counts in the aside, inline delete', async ({ page }) => {
      await open(page, '/projects/templates/1')
      await expect(page.getByRole('heading', { level: 1, name: 'إطلاق خدمة' })).toBeVisible()
      await expect(page.locator('[data-slot="record-section"]')).toHaveCount(3)
      await expect(page.locator('[data-slot="properties-panel"]')).toBeVisible()
      await page.getByRole('button', { name: 'حذف' }).first().click()
      await expect(page.getByTestId('template-delete-confirm')).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
    })
    test('apply is a form page with a form section', async ({ page }) => {
      await open(page, '/projects/templates/1/apply')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('استخدام قالب المشروع')
      await expect(page.getByLabel('اسم المشروع الجديد')).toHaveValue('إطلاق خدمة')
    })
  })
  test.describe('phone', () => {
    test.use({ viewport: PHONE })
    test('the phone rows carry the name, the description and the counts', async ({ page }) => {
      await open(page, '/projects/templates')
      await expect(mobileRows(page)).toHaveCount(3)
      await expect(mobileRows(page).first()).toContainText('مراحل ومهام إطلاق خدمة')
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
