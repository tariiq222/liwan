import { expect, test } from '@playwright/test'
import { DESKTOP, PHONE, login, open, rows, mobileRows, fitsWidth, expectFrameOwnsH1 } from './support/tasmim6'

test.describe('Plan 6a: project settings and catalogs', () => {
  test.beforeEach(async ({ page }) => { await login(page) })
  test.describe('desktop', () => {
    test.use({ viewport: DESKTOP })
    test('the settings page lists the catalogs as a section with both links', async ({ page }) => {
      await open(page, '/settings/apps/projects')
      await expect(page.getByTestId('settings-layout')).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.locator('#catalogs')).toBeVisible()
      await expect(page.getByTestId('catalog-types-link')).toBeVisible()
      await expect(page.getByTestId('catalog-units-link')).toBeVisible()
    })
    test('the catalog is a data table: active rows, the scope tabs, keyboard create', async ({ page }) => {
      await open(page, '/settings/apps/projects/catalogs/types')
      await expect(page.getByRole('heading', { level: 1, name: 'أنواع المشاريع' })).toBeVisible()
      await expect(page.getByTestId('catalog-toolbar')).toBeVisible()
      await expect(rows(page)).toHaveCount(2)
      await page.getByTestId('catalog-scope').getByRole('button', { name: 'الكل' }).click()
      await expect(page).toHaveURL(/active=all/)
      await expect(rows(page)).toHaveCount(3)
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('c')
      await expect(page).toHaveURL(/\/settings\/apps\/projects\/catalogs\/types\/new/)
      await expect(page.getByRole('dialog')).toBeVisible()
    })
    test('J and K move between rows; a row action asks inline', async ({ page }) => {
      await open(page, '/settings/apps/projects/catalogs/owning-units')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(rows(page).nth(0)).toBeFocused()
      await rows(page).nth(0).getByTestId('row-actions-menu').click()
      await page.getByRole('menuitem', { name: 'حذف' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByText(/حذف «/)).toBeVisible()
    })
  })
  test.describe('phone', () => {
    test.use({ viewport: PHONE })
    test('the phone rows carry the name, the sequence and the actions menu', async ({ page }) => {
      await open(page, '/settings/apps/projects/catalogs/types')
      await expect(mobileRows(page)).toHaveCount(2)
      await expect(mobileRows(page).first().getByTestId('row-actions-menu')).toBeVisible()
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
