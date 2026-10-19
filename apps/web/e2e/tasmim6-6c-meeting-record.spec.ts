import { expect, test, type Page } from '@playwright/test'

// Plan 6c: /meetings/1 on SharedRecordPage with route tabs (isolated mock stack).
// Meeting 1: «اجتماع متابعة التحول الرقمي», MTG-001, confirmed, can_edit + can_manage, series 1 (monthly), project «تطوير الخدمات الرقمية»,
// one open recommendation, one attachment «محضر الاجتماع.pdf», one event, one version.
import { login, open, fitsWidth } from './support/tasmim6'
test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Isolated synthetic API only')
const NAME = 'اجتماع متابعة التحول الرقمي'
const tab = (page: Page, name: string) => page.getByTestId(`meeting-tab-${name}`)

test.describe('Plan 6c: the meeting record', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('is the record template: one h1 with the name, seven tab links, and the properties aside', async ({ page }) => {
      await open(page, '/meetings/1')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME)
      await expect(page.locator('[data-template="record"]')).toHaveCount(1)
      await expect(page.getByRole('navigation', { name: 'أقسام الاجتماع', exact: true })).toBeVisible()
      await expect(page.getByTestId('meeting-tabs').getByRole('link')).toHaveCount(7)
      await expect(tab(page, 'summary')).toHaveAttribute('aria-current', 'page')
      await expect(page.locator('#meeting-summary')).toBeVisible()
      const aside = page.getByRole('complementary', { name: 'الخصائص' })
      await expect(aside.locator('[data-slot="property-row"]')).toHaveCount(5)
      await expect(page.getByTestId('meeting-state-badge')).toHaveText('مؤكد')
      await expect(aside).toContainText('MTG-001')
      await expect(aside.getByRole('link', { name: 'اجتماعات متابعة التحول الرقمي' })).toHaveAttribute('href', '/meetings/series/1')
      await expect(aside).toContainText('تطوير الخدمات الرقمية')
    })

    test('the header actions keep their targets', async ({ page }) => {
      await open(page, '/meetings/1')
      await expect(page.getByRole('link', { name: 'معاينة وطباعة', exact: true })).toHaveAttribute('href', /\/meetings\/1\/print/)
      await expect(page.getByRole('link', { name: 'تعديل', exact: true })).toHaveAttribute('href', /\/meetings\/1\/edit/)
      await expect(page.getByRole('button', { name: 'إنهاء', exact: true })).toBeEnabled()
    })

    test('a tab link switches the panel, pushes history and Back returns to the previous tab', async ({ page }) => {
      await open(page, '/meetings/1')
      await tab(page, 'resolutions').click()
      await expect(page).toHaveURL(/tab=resolutions/)
      await expect(tab(page, 'resolutions')).toHaveAttribute('aria-current', 'page')
      await expect(page.locator('#meeting-resolutions').getByRole('heading', { level: 2, name: 'التوصيات' })).toBeVisible()
      await expect(page.locator('#meeting-summary')).toHaveCount(0)
      await expect(page.locator('#meeting-resolutions [data-tone]').first()).toBeVisible()
      await page.goBack()
      await expect(tab(page, 'summary')).toHaveAttribute('aria-current', 'page')
      await expect(page.locator('#meeting-summary')).toBeVisible()
    })

    test('every tab renders its own section', async ({ page }) => {
      await open(page, '/meetings/1')
      for (const [name, selector] of [
        ['agenda', '#meeting-agenda'], ['minutes', '[data-testid="meeting-minutes-document"]'], ['resolutions', '#meeting-resolutions'],
        ['attachments', '#meeting-attachments'], ['history', '[data-testid="meeting-event-list"]'], ['versions', '[data-testid="meeting-version-list"]'],
      ] as const) {
        await tab(page, name).click()
        await expect(tab(page, name)).toHaveAttribute('aria-current', 'page')
        await expect(page.locator(selector)).toBeVisible()
      }
    })

    test('an unknown ?tab= shows the summary, and a legacy hash opens its tab', async ({ page }) => {
      await open(page, '/meetings/1?tab=bogus')
      await expect(tab(page, 'summary')).toHaveAttribute('aria-current', 'page')
      await expect(page.locator('#meeting-summary')).toBeVisible()
      await open(page, '/meetings/1#meeting-resolutions')
      await expect(tab(page, 'resolutions')).toHaveAttribute('aria-current', 'page')
      await tab(page, 'summary').click()
      await expect.poll(() => new URL(page.url()).hash).toBe('')
    })

    test('a tab link keeps returnTo, so Back still returns to the filtered list', async ({ page }) => {
      await open(page, '/meetings?q=%D8%A7%D8%AC%D8%AA%D9%85%D8%A7%D8%B9')
      await page.getByTestId('meeting-row').click()
      await expect(page).toHaveURL(/\/meetings\/1/)
      await tab(page, 'minutes').click()
      expect(new URL(page.url()).searchParams.get('returnTo')).toContain('/meetings')
      await page.getByRole('link', { name: 'رجوع' }).click()
      await expect(page).toHaveURL(/\/meetings\?(?=.*q=)/)
    })

    test('cancelling asks inline, with the series scope, and Cancel changes nothing', async ({ page }) => {
      await open(page, '/meetings/1')
      await page.getByTestId('meeting-more-actions').click()
      await page.getByRole('menuitem', { name: 'إلغاء الاجتماع' }).click()
      const confirm = page.getByTestId('inline-confirm')
      await expect(confirm).toBeVisible()
      await expect(confirm).toContainText(NAME)
      await expect(confirm.getByRole('combobox')).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.getByTestId('inline-confirm-cancel').click()
      await expect(confirm).toHaveCount(0)
    })

    test('deleting an attachment asks inline first', async ({ page }) => {
      await open(page, '/meetings/1?tab=attachments')
      const section = page.locator('#meeting-attachments')
      await expect(section.getByRole('link', { name: 'محضر الاجتماع.pdf' })).toBeVisible()
      await section.getByRole('button', { name: 'حذف المرفق' }).click()
      await expect(section.getByTestId('inline-confirm')).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await section.getByTestId('inline-confirm-cancel').click()
      await expect(section.getByTestId('inline-confirm')).toHaveCount(0)
    })

    test('the new-recommendation link opens the create panel over the resolutions tab', async ({ page }) => {
      await open(page, '/meetings/1?tab=resolutions')
      await page.locator('#meeting-resolutions a[href*="/resolutions/new"]').click()
      await expect(page).toHaveURL(/\/meetings\/1\/resolutions\/new/)
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(tab(page, 'resolutions')).toHaveAttribute('aria-current', 'page')
    })

    test('a meeting that does not exist shows the not-found state and no aside', async ({ page }) => {
      await page.goto('/meetings/999')
      await expect(page.locator('[data-slot="not-found-state"]')).toBeVisible()
      await expect(page.locator('[data-slot="record-aside"]')).toHaveCount(0)
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('the tab strip scrolls to keep the active tab in view and nothing overflows', async ({ page }) => {
      await open(page, '/meetings/1')
      const strip = page.getByTestId('meeting-tabs')
      expect(await strip.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true)
      expect(await fitsWidth(page)).toBe(true)
      await tab(page, 'versions').click()
      await expect(tab(page, 'versions')).toHaveAttribute('aria-current', 'page')
      await expect.poll(() => page.evaluate(() => {
        const nav = document.querySelector('[data-testid="meeting-tabs"]')!.getBoundingClientRect()
        const active = document.querySelector('[data-testid="meeting-tab-versions"]')!.getBoundingClientRect()
        return active.left >= nav.left - 1 && active.right <= nav.right + 1
      })).toBe(true)
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
