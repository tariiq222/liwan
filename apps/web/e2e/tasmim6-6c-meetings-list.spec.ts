import { expect, test, type Page } from '@playwright/test'

// Plan 6c: /meetings on SharedListPage + SharedDataTable (isolated mock stack).
// The mock lists five meetings (the KPI tiles need different totals); the first is «اجتماع متابعة التحول الرقمي», MTG-001, 2026-09-15, confirmed, organizer أحمد العتيبي.
import { login, open, fitsWidth } from './support/tasmim6'
test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Isolated synthetic API only')
const rows = (page: Page) => page.locator('tbody tr[data-shortcut-row]')
const mobileRows = (page: Page) => page.locator('li[data-shortcut-row]')

test.describe('Plan 6c: the meetings list', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('is the list template with one h1, a create button and a table', async ({ page }) => {
      await open(page, '/meetings')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('الاجتماعات')
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      const create = page.locator('[data-shortcut-create]')
      await expect(create).toHaveCount(1)
      await expect(create).toHaveAttribute('data-testid', 'meeting-new')
      await expect(create).toContainText('اجتماع جديد')
      await expect(rows(page)).toHaveCount(5)
      await expect(rows(page).first()).toContainText('MTG-001')
      await expect(page.getByTestId('meeting-row').first()).toHaveAttribute('href', /\/meetings\/1\?returnTo=/)
      await expect(page.getByTestId('meeting-row-state').first()).toHaveText('مؤكد')
      await expect(page.getByTestId('meeting-row-state').first()).toHaveAttribute('data-tone', 'info')
      await expect(page.getByTestId('meeting-scope')).toBeVisible()
    })

    test('J moves through the rows, / focuses the search, C creates a meeting, Enter opens the row', async ({ page }) => {
      await open(page, '/meetings')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/meetings\/1/)
      await open(page, '/meetings')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('/')
      await expect(page.locator('[data-shortcut-search] input')).toBeFocused()
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('c')
      await expect(page).toHaveURL(/\/meetings\/new\?returnTo=/)
    })

    test('a search is kept in the URL and Back from the meeting returns to it', async ({ page }) => {
      await open(page, '/meetings')
      await page.locator('#meeting-search').fill('اجتماع')
      await expect(page).toHaveURL(/q=/)
      await page.getByTestId('meeting-row').first().click()
      await expect(page).toHaveURL(/\/meetings\/1/)
      await page.getByRole('link', { name: 'رجوع' }).click()
      await expect(page).toHaveURL(/\/meetings\?(?=.*q=)/)
      await expect(page.locator('#meeting-search')).toHaveValue('اجتماع')
    })

    test('a click on the row opens the meeting', async ({ page }) => {
      await open(page, '/meetings')
      await rows(page).first().locator('td').nth(2).click({ position: { x: 4, y: 4 } })
      await expect(page).toHaveURL(/\/meetings\/1/)
    })

    test('a reversed date range shows the alert and no table', async ({ page }) => {
      await open(page, '/meetings?date_from=2026-09-10&date_to=2026-09-01')
      await expect(page.getByRole('alert')).toBeVisible()
      await expect(page.locator('table')).toHaveCount(0)
      await expect(page.locator('[data-slot="data-table"]')).toHaveCount(0)
    })

    test('/meetings/new keeps the list behind the create panel', async ({ page }) => {
      await open(page, '/meetings/new')
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('the mobile rows carry the same information and J skips the hidden table', async ({ page }) => {
      await open(page, '/meetings')
      await expect(mobileRows(page)).toHaveCount(5)
      await expect(page.locator('table')).toBeHidden()
      const row = mobileRows(page).first()
      await expect(row).toContainText('اجتماع متابعة التحول الرقمي')
      await expect(row).toContainText('MTG-001')
      await expect(row).toContainText('مؤكد')
      expect(await fitsWidth(page)).toBe(true)
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(mobileRows(page).nth(0)).toBeFocused()
    })
  })
})
