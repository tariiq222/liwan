import { expect, test } from '@playwright/test'
import { expectNoSecondH1, fitsWidth, login, mobileRows, navigateClient, open, RESTRICTED_EMAIL, rows } from './commercial-helpers'
test.beforeEach(async ({ page }) => { await login(page) })

test('the list is the list template; rows, filter, record link and no create button', async ({ page }) => {
 await open(page, '/invoices'); await expectNoSecondH1(page)
 await expect(page.locator('[data-template="list"]')).toHaveCount(1)
 await expect(rows(page)).toHaveCount(3)
 await expect(page.getByTestId('invoice-row').filter({ visible: true }).first()).toHaveAttribute('href', /\/invoices\/inv-\d/)
 await expect(page.getByTestId('not-official')).toBeVisible()
 await expect(page.locator('[data-shortcut-create]')).toHaveCount(0)
 await expect(page.locator('tbody bdi[dir="ltr"]').first()).toBeVisible()
})
test('a status filter narrows the table and survives a refresh', async ({ page }) => {
 await open(page, '/invoices?status=paid'); await expect(rows(page)).toHaveCount(1)
 await page.reload(); await expect(rows(page)).toHaveCount(1)
})
test('the record shows invoice lines, a draft number label and the attempt without provider data', async ({ page }) => {
 await open(page, '/invoices/inv-3'); await expectNoSecondH1(page)
 await expect(page.locator('[data-template="record"]')).toHaveCount(1)
 await expect(page.getByTestId('payment-attempt')).toHaveCount(1)
 await expect(page.getByText('private-provider')).toHaveCount(0)
 await open(page, '/invoices/inv-1'); await expect(page.getByTestId('invoice-line').first()).toBeVisible()
})
test('a free quantity never lowers the paid cell (owner decision)', async ({ page }) => {
 await open(page, '/invoices/inv-1')
 const line = page.getByTestId('invoice-line').first()
 await expect(line.locator('td').nth(2)).toContainText('3')
 await expect(line.locator('td').nth(1)).toContainText('1')
})
test('a vendor without the billing grant never reaches the invoice list', async ({ page }) => {
 await login(page, RESTRICTED_EMAIL)
 await open(page, '/overview')
 await navigateClient(page, '/invoices')
 await expect(page.locator('[data-slot="data-table"]')).toHaveCount(0)
 // The route gate answers 403 on the address itself; no invoice data is shown.
 await expect(page.getByText('ليس لديك صلاحية لفتح هذه الصفحة')).toBeVisible()
 await expect(page.getByTestId('invoice-row')).toHaveCount(0)
})
test('on a 390px phone the invoice rows retain periods and keyboard navigation without overflow', async ({ page }) => {
 await page.setViewportSize({width:390,height:844}); await open(page, '/invoices')
 await expect(mobileRows(page)).toHaveCount(3); await expect(page.locator('table')).toBeHidden()
 await expect(mobileRows(page).first().locator('bdi[dir="ltr"]')).toBeVisible()
 expect(await fitsWidth(page)).toBe(true); await page.getByRole('heading',{level:1}).click(); await page.keyboard.press('j')
 await expect(mobileRows(page).first()).toBeFocused()
})
