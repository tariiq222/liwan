import { expect, test } from '@playwright/test'
import { fitsWidth, loginAdmin, openShell } from './support/tasmim6d'

// Plan 6d: /search on SharedRecordPage (isolated mock stack).
test.describe('Plan 6d: the search page', () => {
  test.beforeEach(async ({ page }) => { await loginAdmin(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('is the record template: one h1, the unfocused input and a back link', async ({ page }) => {
      await openShell(page, '/search?returnTo=/projects')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('بحث')
      await expect(page.locator('[data-template="record"]')).toHaveCount(1)
      await expect(page.getByTestId('search-page')).toBeVisible()
      await expect(page.locator('#navigation-search')).not.toBeFocused()
      await expect(page.locator('[data-shortcut-search]')).toHaveCount(1)
      await expect(page.getByRole('link', { name: 'رجوع' }).first()).toHaveAttribute('href', /\/projects/)
    })

    test('a slash focuses the field', async ({ page }) => {
      await openShell(page, '/search')
      await page.keyboard.press('/')
      await expect(page.locator('#navigation-search')).toBeFocused()
    })

    test('typing filters the navigation group and keeps q in the URL', async ({ page }) => {
      await openShell(page, '/search')
      await page.locator('#navigation-search').fill('مشاريع')
      await expect(page).toHaveURL(/q=/)
      const group = page.getByRole('heading', { level: 2 }).first()
      await expect(group).toBeVisible()
      await expect(page.locator('main a[href^="/projects"]').first()).toBeVisible()
    })

    test('a term nothing matches shows the shared empty state', async ({ page }) => {
      await openShell(page, '/search?q=zzzzqqqq')
      await expect(page.locator('[role="status"]', { hasText: 'لا نتائج' })).toBeVisible()
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })
    test('on a 390px phone the page fits the width', async ({ page }) => {
      await openShell(page, '/search?q=%D9%85')
      await expect(page.locator('#navigation-search')).toBeVisible()
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
