import { expect, test, type Page } from '@playwright/test'

// Plan 6c: /meetings/series on SharedListPage + SharedDataTable (isolated mock stack).
// The mock lists one series: «اجتماعات متابعة التحول الرقمي», monthly, organizer أحمد العتيبي, project تطوير الخدمات الرقمية, 1 open / 0 overdue.
import { login, open, fitsWidth } from './support/tasmim6'
test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Isolated synthetic API only')
const rows = (page: Page) => page.locator('tbody tr[data-shortcut-row]')
const mobileRows = (page: Page) => page.locator('li[data-shortcut-row]')

test.describe('Plan 6c: the series list', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('is the list template with one h1, the create button, the total and a table', async ({ page }) => {
      await open(page, '/meetings/series')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('الاجتماعات الدورية')
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      const create = page.locator('[data-shortcut-create]')
      await expect(create).toHaveAttribute('data-testid', 'meeting-series-new')
      await expect(create).toContainText('اجتماع دوري جديد')
      await expect(page.getByRole('status').filter({ hasText: 'عدد الاجتماعات الدورية: 1' })).toBeVisible()
      await expect(rows(page)).toHaveCount(1)
      await expect(rows(page).first()).toContainText('شهري')
      await expect(rows(page).first()).toContainText('أحمد العتيبي')
      await expect(rows(page).first()).toContainText('تطوير الخدمات الرقمية')
      await expect(rows(page).first().getByRole('link').first()).toHaveAttribute('href', /\/meetings\/series\/1\?returnTo=/)
    })

    test('J, Enter, / and C work', async ({ page }) => {
      await open(page, '/meetings/series')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/meetings\/series\/1/)
      await open(page, '/meetings/series')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('/')
      await expect(page.locator('[data-shortcut-search] input')).toBeFocused()
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('c')
      await expect(page).toHaveURL(/\/meetings\/series\/new\?returnTo=/)
    })

    test('/meetings/series/new keeps the list behind the create panel', async ({ page }) => {
      await open(page, '/meetings/series/new')
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
    })

    test('the series record opened from the list returns to it with its search', async ({ page }) => {
      await open(page, '/meetings/series')
      await page.locator('#meeting-series-search').fill('اجتماعات')
      await expect(page).toHaveURL(/q=/)
      await rows(page).first().getByRole('link').first().click()
      await expect(page).toHaveURL(/\/meetings\/series\/1/)
      await page.getByRole('link', { name: 'رجوع' }).click()
      await expect(page).toHaveURL(/\/meetings\/series\?(?=.*q=)/)
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('the mobile rows carry the same information', async ({ page }) => {
      await open(page, '/meetings/series')
      await expect(mobileRows(page)).toHaveCount(1)
      await expect(page.locator('table')).toBeHidden()
      const row = mobileRows(page).first()
      await expect(row).toContainText('اجتماعات متابعة التحول الرقمي')
      await expect(row).toContainText('شهري')
      await expect(row).toContainText('أحمد العتيبي')
      expect(await fitsWidth(page)).toBe(true)
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(mobileRows(page).nth(0)).toBeFocused()
    })
  })
})
