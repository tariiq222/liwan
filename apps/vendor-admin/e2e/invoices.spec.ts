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
test('the record shows invoice lines, a draft number label and the attempt with its kind and no reference when it has none', async ({ page }) => {
 await open(page, '/invoices/inv-3'); await expectNoSecondH1(page)
 await expect(page.locator('[data-template="record"]')).toHaveCount(1)
 await expect(page.getByTestId('payment-attempt')).toHaveCount(1)
 await expect(page.getByTestId('attempt-ref')).toHaveCount(0)
 await expect(page.getByTestId('payment-attempt')).toContainText('فاتورة مستضافة')
 await open(page, '/invoices/inv-1'); await expect(page.getByTestId('invoice-line').first()).toBeVisible()
})
test('a first payment offers the general refund request, not the AI top-up refund', async ({ page }) => {
 await open(page, '/invoices/inv-2')
 await expect(page.getByTestId('request-refund-action')).toHaveAttribute('data-refund-kind', 'invoice')
 await expect(page.getByTestId('request-refund-action')).toHaveCount(1)
})
test('a later AI top-up is refunded through its own action with the units used and a reason, never the general request', async ({ page }) => {
 await open(page, '/invoices/inv-topup')
 const action = page.getByTestId('request-refund-action')
 await expect(action).toHaveAttribute('data-refund-kind', 'ai-topup'); await expect(action).toHaveCount(1)
 await expect(page.getByTestId('refund-request-blocked')).toHaveCount(0)
 let sent: { url: string, body: unknown } | undefined
 await page.route('**/api/vendor/v1/commercial/ai-topups/*/refund', async (route) => {
  sent = { url: route.request().url(), body: route.request().postDataJSON() }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ adjustment_id: 'note-1' }) })
 })
 await expect(action).toBeEnabled(); await action.click()
 await page.getByTestId('request-units-used').fill('0')
 await page.locator('textarea').last().fill('Customer asked for the unused top-up back')
 await page.getByRole('button', { name: 'استرداد الرصيد' }).click()
 await expect(page.getByTestId('request-refund-failure')).toHaveCount(0)
 await expect.poll(() => sent?.body).toEqual({ reason: 'Customer asked for the unused top-up back', units_used: 0 })
 expect(sent?.url).toContain('/commercial/ai-topups/order-alpha-topup/refund')
})
test('an unpaid renewal invoice is voided with a chosen outcome and a reason, and a paid one offers the refund instead', async ({ page }) => {
 await open(page, '/invoices/inv-renewal')
 const action = page.getByTestId('void-action')
 await expect(action).toBeEnabled(); await expect(page.getByTestId('void-blocked')).toHaveCount(0)
 await expect(page.getByTestId('request-refund-action')).toHaveCount(0)
 let sent: { url: string, body: unknown } | undefined
 await page.route('**/api/vendor/v1/commercial/invoices/*/void', async (route) => {
  sent = { url: route.request().url(), body: route.request().postDataJSON() }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'inv-renewal', status: 'void' }) })
 })
 await action.click()
 // Neither the outcome nor a reason is preset: the confirm waits for both.
 const confirm = page.getByRole('button', { name: 'إلغاء الفاتورة' }).last()
 await expect(confirm).toBeDisabled()
 await page.getByTestId('void-outcome').click(); await page.getByRole('option', { name: 'إعادة فوترة الفترة' }).click()
 await expect(confirm).toBeDisabled()
 await page.getByTestId('void-reason').fill('Customer will not pay this invoice')
 await expect(confirm).toBeEnabled(); await confirm.click()
 await expect.poll(() => sent?.body).toEqual({ reason: 'Customer will not pay this invoice', outcome: 'rebill' })
 expect(sent?.url).toContain('/commercial/invoices/inv-renewal/void')
 await expect(page.getByTestId('void-failure')).toHaveCount(0)
 // A paid invoice is refunded, never voided.
 await open(page, '/invoices/inv-2')
 await expect(page.getByTestId('void-action')).toHaveCount(0)
 await expect(page.getByTestId('request-refund-action')).toHaveCount(1)
})
test('an unpaid renewal invoice with a customer transfer claim shows why it cannot be voided', async ({ page }) => {
 await open(page, '/invoices/inv-renewal-claimed')
 await expect(page.getByTestId('void-action')).toBeDisabled()
 await expect(page.getByTestId('void-blocked')).toBeVisible()
 await expect(page.getByTestId('void-action')).toHaveAttribute('aria-describedby', 'void-blocked')
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
test('on a 390px phone the invoice record scrolls its lines table inside its own box, never the page', async ({ page }) => {
 await page.setViewportSize({width:390,height:844})
 for (const id of ['inv-1', 'inv-2', 'inv-3']) { await open(page, `/invoices/${id}`); expect(await fitsWidth(page), id).toBe(true) }
})

test('an issued invoice opens its print route: the customer document, a print action and a way back; no console chrome prints', async ({ page }) => {
 await open(page, '/invoices/inv-1')
 await page.getByTestId('invoice-print-open').click()
 await expect(page).toHaveURL(/\/invoices\/print\/inv-1\?returnTo=/)
 const document = page.getByTestId('invoice-document')
 await expect(document).toBeVisible()
 await expect(page.getByTestId('invoice-seller-name')).toHaveText('شركة ليوان المحدودة')
 await expect(page.getByTestId('invoice-customer')).toBeVisible()
 // A document of Liwan, which is not VAT-registered: no tax wording, no reference to a payment provider or an operator.
 await expect(document).not.toContainText(/فاتورة ضريبية|tax invoice|VAT|private-provider|provider/i)
 await page.evaluate(() => { (window as unknown as { printed: number }).printed = 0; window.print = () => { (window as unknown as { printed: number }).printed++ } })
 await page.emulateMedia({ media: 'print' })
 await expect(page.getByTestId('invoice-print-action')).toBeHidden()
 await expect(page.getByTestId('invoice-print-back')).toBeHidden()
 await page.emulateMedia({ media: 'screen' })
 await page.getByTestId('invoice-print-action').click()
 expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1)
 await page.getByTestId('invoice-print-back').click()
 await expect(page).toHaveURL(/\/invoices\/inv-1(\?|$)/)
})
test('a draft invoice has no print button and its print route shows no document', async ({ page }) => {
 await open(page, '/invoices/inv-3')
 await expect(page.getByTestId('invoice-print-open')).toHaveCount(0)
 await open(page, '/invoices/print/inv-3')
 await expect(page.getByTestId('invoice-document')).toHaveCount(0)
 await expect(page.getByTestId('invoice-print-action')).toHaveCount(0)
 await expect(page.getByTestId('invoice-print-back')).toBeVisible()
})
test('the invoice list exports a CSV of every matching invoice after the audit record, and no file when that record fails', async ({ page }) => {
 await open(page, '/invoices?status=paid')
 let sent: unknown
 await page.route('**/api/vendor/v1/commercial/invoices/export', async (route) => {
  sent = route.request().postDataJSON()
  await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'audit-1' }) })
 })
 const download = page.waitForEvent('download')
 await page.getByTestId('invoices-export').click()
 const file = await download
 expect(file.suggestedFilename()).toMatch(/^liwan-invoices-paid-\d{4}-\d{2}-\d{2}\.csv$/)
 const bytes = await (await import('node:fs/promises')).readFile((await file.path())!)
 expect([...bytes.subarray(0, 3)]).toEqual([0xEF, 0xBB, 0xBF])
 const lines = bytes.toString('utf8').slice(1).trimEnd().split('\r\n')
 expect(lines).toHaveLength(2)
 expect(lines[1]).toContain('inv-2')
 expect(sent).toEqual({ status: 'paid', row_count: 1 })
 await expect(page.getByTestId('invoice-export-failure')).toHaveCount(0)
 // The record is refused: the page says so and no file is made.
 await page.unroute('**/api/vendor/v1/commercial/invoices/export')
 await page.route('**/api/vendor/v1/commercial/invoices/export', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'internal_error' }) }))
 let downloaded = false
 page.on('download', () => { downloaded = true })
 await page.getByTestId('invoices-export').click()
 await expect(page.getByTestId('invoice-export-failure')).toBeVisible()
 expect(downloaded).toBe(false)
})
