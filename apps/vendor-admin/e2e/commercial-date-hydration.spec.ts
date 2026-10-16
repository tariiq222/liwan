import { expect, test } from '@playwright/test'
import { login, open, switchLocale } from './commercial-helpers'

test.describe('Plan 7: commercial dates hydrate in the interface language', () => {
  // A browser locale that differs from Node's default reproduces the captured warning.
  test.use({ locale: 'ar-SA', viewport: { width: 1440, height: 900 } })

  for (const locale of ['ar', 'en']) {
    for (const path of ['/overview', '/customers/cust-alpha', '/operations']) {
      test(`${path} renders ${locale} dates independently of the browser language`, async ({ page }) => {
        await login(page)
        await open(page, '/overview')
        const warnings: string[] = []
        page.on('console', message => {
          if (message.type() === 'warning' && /Hydration text (?:content )?mismatch/.test(message.text())) warnings.push(message.text())
        })
        if (locale === 'ar') await open(page, path)
        else {
          // no_prefix/defaultLocale=ar intentionally gives direct SSR an Arabic first paint.
          // Exercise the supported English client navigation after changing interface language.
          await switchLocale(page, locale, path)
        }
        await expect(page.locator('html')).toHaveAttribute('lang', new RegExp(`^${locale}(?:-|$)`))
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
        if (path === '/overview') await expect(page.locator('time[datetime]')).toBeVisible()
        else if (path.includes('/customers/')) await expect(page.locator('[data-slot="properties-panel"]').first()).toBeVisible()
        else await expect(page.locator('tbody tr[data-shortcut-row]').first()).toBeVisible()
        const timestamp = path === '/overview'
          ? page.locator('time[datetime]')
          : path.includes('/customers/')
            ? page.locator('[data-slot="properties-panel"] [data-slot="property-row"]').last().locator('dd')
            : page.locator('tbody tr[data-shortcut-row]').first().locator('td').last()
        if (locale === 'en') {
          await expect(timestamp).toContainText('2026')
          await expect(timestamp).not.toContainText(/[٠-٩]/)
        }
        expect(warnings).toEqual([])
      })
    }
    test(`invoice dates keep their reading order in ${locale}`, async ({ page }) => {
      await login(page)
      await open(page, '/invoices/inv-1')
      if (locale === 'en') await switchLocale(page, 'en')
      const panel = page.locator('[data-slot="properties-panel"]')
      // The shared date format isolates its numeric run (one LRI ... PDI pair, Latin digits) so Arabic text cannot
      // reorder it; the billing period is a plain ISO range inside an LTR island.
      const isolated = /^\u2066\d{2}\/\d{2}\/2026\u2069$/
      await expect(panel.locator('dd bdi')).toHaveText(/^2026-\d{2}-\d{2} → 2026-\d{2}-\d{2}$/)
      const rows = panel.locator('[data-slot="property-row"]')
      await expect(rows.nth(2).locator('dd')).toHaveText(isolated)
      await expect(page.getByTestId('invoice-header')).toContainText(/\u2066\d{2}\/\d{2}\/2026\u2069/)
    })
  }
})
