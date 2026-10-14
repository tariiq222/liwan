import { expect, test } from '@playwright/test'
import { expectNoSecondH1, fitsWidth, login, mobileRows, open, rows } from './tasmim6-commercial-helpers'
test.beforeEach(async ({ page }) => { await login(page) })

test('the quote preview draws shared invoice lines and totals and settles aria busy', async ({ page }) => {
 await open(page,'/vendor/plans/00000000-0000-4000-8000-000000000010'); const preview=page.getByTestId('quote-preview')
 await expect(preview.locator('[data-slot="invoice-lines"]')).toBeVisible(); await expect(preview.getByTestId('invoice-line')).not.toHaveCount(0)
 await expect(preview.locator('[data-slot="invoice-lines"] dl')).toContainText(/ر.س|SAR|ريال/)
 await expect(preview.locator('[data-slot="price-breakdown"]')).toHaveAttribute('aria-busy','false')
 await page.setViewportSize({width:390,height:844}); await expect.poll(() => fitsWidth(page)).toBe(true)
})
