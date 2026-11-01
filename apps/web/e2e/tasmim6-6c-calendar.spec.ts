import { expect, test, type Page } from '@playwright/test'

// Plan 6c: /meetings/calendar on SharedTimelineFrame (isolated mock stack).
// The calendar is a view of the meetings page (h1 «الاجتماعات»). The mock has five meetings; meeting 1 is on 2026-09-15 (confirmed, 09:00).
import { login, open, fitsWidth } from './support/tasmim6'
test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Isolated synthetic API only')
const monthParams = (url: string) => { const params = new URL(url).searchParams; return { year: params.get('year'), month: params.get('month') } }

test.describe('Plan 6c: the meetings calendar', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('is the timeline frame with one h1, the toolbar and the month grid', async ({ page }) => {
      await open(page, '/meetings/calendar?year=2026&month=9')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('الاجتماعات')
      await expect(page.locator('[data-template="timeline-frame"]')).toHaveCount(1)
      await expect(page.getByTestId('timeline-range')).toContainText(/2026|٢٠٢٦/)
      for (const id of ['timeline-prev', 'timeline-today', 'timeline-next']) await expect(page.getByTestId(id)).toBeEnabled()
      const meeting = page.locator('main a[href^="/meetings/1?"]:visible').first()
      await expect(meeting).toBeVisible()
      await expect(meeting).toContainText('اجتماع متابعة التحول الرقمي')
      await expect(meeting).toContainText('مؤكد')
    })

    test('previous and next change the month in the URL, Today comes back', async ({ page }) => {
      await open(page, '/meetings/calendar?year=2026&month=9')
      await page.getByTestId('timeline-next').click()
      await expect.poll(() => monthParams(page.url())).toEqual({ year: '2026', month: '10' })
      await page.getByTestId('timeline-prev').click()
      await page.getByTestId('timeline-prev').click()
      await expect.poll(() => monthParams(page.url())).toEqual({ year: '2026', month: '8' })
      await page.getByTestId('timeline-today').click()
      const now = new Date()
      await expect.poll(() => monthParams(page.url())).toEqual({ year: String(now.getFullYear()), month: String(now.getMonth() + 1) })
    })

    test('Previous from January goes to December of the previous year', async ({ page }) => {
      await open(page, '/meetings/calendar?year=2026&month=1')
      await page.getByTestId('timeline-prev').click()
      await expect.poll(() => monthParams(page.url())).toEqual({ year: '2025', month: '12' })
    })

    test('a bad month or year falls back to the current month and the URL is corrected', async ({ page }) => {
      await open(page, '/meetings/calendar?year=abc&month=13')
      const now = new Date()
      await expect.poll(() => monthParams(page.url())).toEqual({ year: String(now.getFullYear()), month: String(now.getMonth() + 1) })
      // A month outside 1-12 falls back to the current month; a valid year is kept.
      await open(page, '/meetings/calendar?year=2026&month=0')
      await expect.poll(() => monthParams(page.url())).toEqual({ year: '2026', month: String(now.getMonth() + 1) })
    })

    test('a day in the URL opens its day card', async ({ page }) => {
      await open(page, '/meetings/calendar?year=2026&month=9&day=2026-09-15')
      const card = page.getByRole('complementary', { name: 'أحداث اليوم' })
      await expect(card).toBeVisible()
      await expect(card).toContainText('اجتماع متابعة التحول الرقمي')
      await expect(card.getByRole('link', { name: /اجتماع متابعة التحول الرقمي/ })).toHaveAttribute('href', /\/meetings\/1\?returnTo=/)
    })

    test('a meeting opened from the calendar returns to the same month', async ({ page }) => {
      await open(page, '/meetings/calendar?year=2026&month=9')
      await page.locator('main a[href^="/meetings/1?"]:visible').first().click()
      await expect(page).toHaveURL(/\/meetings\/1/)
      await page.getByRole('link', { name: 'رجوع' }).click()
      await expect.poll(() => monthParams(page.url())).toEqual({ year: '2026', month: '9' })
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('the agenda replaces the grid and nothing overflows', async ({ page }) => {
      await open(page, '/meetings/calendar?year=2026&month=9')
      const agenda = page.locator('main a[href^="/meetings/1?"]:visible')
      await expect(agenda.first()).toBeVisible()
      await expect(page.getByTestId('timeline-range')).toBeVisible()
      expect(await fitsWidth(page)).toBe(true)
      await page.getByTestId('timeline-next').click()
      await expect.poll(() => monthParams(page.url()).month).toBe('10')
    })
  })
})
