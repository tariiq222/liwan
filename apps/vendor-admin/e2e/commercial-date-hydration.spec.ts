import { expect, test } from '@playwright/test'
import { login, open } from './commercial-helpers'

test.describe('Plan 7: commercial dates hydrate in the interface language', () => {
  // A browser locale that differs from Node's default reproduces the captured warning.
  test.use({ locale: 'ar-SA', viewport: { width: 1440, height: 900 } })

  for (const locale of ['ar', 'en']) {
    for (const path of ['/overview', '/tenants/tenant-1', '/operations']) {
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
          await page.evaluate(async ({ target, destination }) => {
            const app = (window as any).useNuxtApp()
            await app.$i18n.setLocale(target)
            await app.$router.push(destination)
          }, { target: locale, destination: path })
        }
        await expect(page.locator('html')).toHaveAttribute('lang', new RegExp(`^${locale}(?:-|$)`))
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
        if (path === '/overview') await expect(page.locator('time[datetime]')).toBeVisible()
        else if (path.includes('/tenants/')) await expect(page.locator('[data-slot="properties-panel"]')).toBeVisible()
        else await expect(page.locator('tbody tr[data-shortcut-row]').first()).toBeVisible()
        const timestamp = path === '/overview'
          ? page.locator('time[datetime]')
          : path.includes('/tenants/')
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
      if (locale === 'en') await page.evaluate(async () => (window as any).useNuxtApp().$i18n.setLocale('en'))
      const dates = page.locator('[data-slot="properties-panel"] dd bdi')
      await expect(dates).toHaveCount(3)
      // The shared date format isolates its numeric run (one LRI ... PDI pair, Latin digits) so Arabic text cannot
      // reorder it; the billing period is a plain ISO range inside an LTR island.
      for (const text of await dates.allTextContents()) expect(text).toMatch(/^(?:\u2066\d{2}\/\d{2}\/2026\u2069|2026-\d{2}-\d{2} → 2026-\d{2}-\d{2})$/)
    })
  }
})
