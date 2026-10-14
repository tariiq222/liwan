import { expect, test, type Page } from '@playwright/test'

// Plan 6c: /meetings/series/1 on SharedRecordPage (isolated mock stack).
// Series 1: «اجتماعات متابعة التحول الرقمي», monthly, organizer أحمد العتيبي, project تطوير الخدمات الرقمية, secretary نورة الحربي,
// location «قاعة الاجتماعات الرئيسية», until 2026-12-31, one meeting (MTG-001, 2026-09-15), one open recommendation.
import { login, open, fitsWidth } from './support/tasmim6'
test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Isolated synthetic API only')
const NAME = 'اجتماعات متابعة التحول الرقمي'
const tab = (page: Page, name: string) => page.getByTestId(`meeting-series-tab-${name}`)
const rows = (page: Page) => page.locator('tbody tr[data-shortcut-row]')

test.describe('Plan 6c: the series record', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('is the record template with one h1, its description, four tab links and the properties aside', async ({ page }) => {
      await open(page, '/meetings/series/1')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME)
      await expect(page.locator('[data-template="record"]')).toHaveCount(1)
      await expect(page.getByRole('navigation', { name: 'أقسام الاجتماع الدوري', exact: true })).toBeVisible()
      await expect(page.locator('[data-template="record"] [data-slot="page-header"]')).toContainText('أحمد العتيبي · شهري')
      await expect(page.getByTestId('meeting-series-tabs').getByRole('link')).toHaveCount(4)
      await expect(tab(page, 'sessions')).toHaveAttribute('aria-current', 'page')
      await expect(page.getByTestId('meeting-series-sessions')).toBeVisible()
      const aside = page.getByRole('complementary', { name: 'الخصائص' })
      await expect(aside.locator('[data-slot="property-row"]')).toHaveCount(4)
      await expect(aside).toContainText('تطوير الخدمات الرقمية')
      await expect(aside).toContainText('نورة الحربي')
      await expect(aside).toContainText('قاعة الاجتماعات الرئيسية')
      await expect(page.getByRole('link', { name: 'إعدادات الاجتماع الدوري' })).toHaveAttribute('href', /\/meetings\/series\/1\/edit/)
    })

    test('each tab link shows its section, sessions carries no tab key, and Back works', async ({ page }) => {
      await open(page, '/meetings/series/1')
      await tab(page, 'followup').click()
      await expect(page).toHaveURL(/tab=followup/)
      await expect(page.getByTestId('meeting-series-followup')).toBeVisible()
      await expect(page.getByTestId('meeting-series-followup').locator('[data-tone]').first()).toBeVisible()
      await tab(page, 'history').click()
      await expect(page.getByTestId('meeting-series-history').getByTestId('meeting-event-list')).toBeVisible()
      await tab(page, 'details').click()
      const details = page.getByTestId('meeting-series-details')
      await expect(details).toContainText('أحمد العتيبي')
      // Location, project and the counts moved to the properties panel.
      await expect(details).not.toContainText('قاعة الاجتماعات الرئيسية')
      await expect(details).not.toContainText('تطوير الخدمات الرقمية')
      await tab(page, 'sessions').click()
      await expect.poll(() => new URL(page.url()).searchParams.has('tab')).toBe(false)
      await page.goBack()
      await expect(tab(page, 'details')).toHaveAttribute('aria-current', 'page')
    })

    test('an unknown ?tab= shows the sessions', async ({ page }) => {
      await open(page, '/meetings/series/1?tab=bogus')
      await expect(tab(page, 'sessions')).toHaveAttribute('aria-current', 'page')
      await expect(page.getByTestId('meeting-series-sessions')).toBeVisible()
    })

    test('the table view is a DataTable with J, Enter and a title link', async ({ page }) => {
      await open(page, '/meetings/series/1?session_view=table')
      await expect(rows(page)).toHaveCount(1)
      await expect(rows(page).first()).toContainText('MTG-001')
      await expect(rows(page).first().getByRole('link').first()).toHaveAttribute('href', /\/meetings\/1\?returnTo=/)
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/meetings\/1/)
    })

    test('the timeline view stays the month-grouped list', async ({ page }) => {
      await open(page, '/meetings/series/1')
      await expect(page.locator('main ol li').first()).toContainText('اجتماع متابعة التحول الرقمي')
      await expect(page.locator('table')).toHaveCount(0)
    })

    test('the series settings route keeps its page and the record is not rendered behind it', async ({ page }) => {
      await open(page, '/meetings/series/1/edit')
      await expect(page.locator('[data-template="record"]')).toHaveCount(0)
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    })

    test('a series that does not exist shows the not-found state', async ({ page }) => {
      await page.goto('/meetings/series/999')
      await expect(page.locator('[data-slot="not-found-state"]')).toBeVisible()
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('the table view uses mobile rows, J skips the hidden table, nothing overflows', async ({ page }) => {
      await open(page, '/meetings/series/1?session_view=table')
      await expect(page.locator('li[data-shortcut-row]')).toHaveCount(1)
      await expect(page.locator('table')).toBeHidden()
      expect(await fitsWidth(page)).toBe(true)
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(page.locator('li[data-shortcut-row]').nth(0)).toBeFocused()
    })
  })
})
