import { expect, test } from '@playwright/test'
import { expectNoSecondH1, fitsWidth, login, mobileRows, open, rows } from './tasmim6-commercial-helpers'
test.beforeEach(async ({ page }) => { await login(page) })

test('the customer list uses the list template, badges and keyboard record navigation', async ({ page }) => {
 await open(page,'/subscription/invoices'); await expectNoSecondH1(page); await expect(page.locator('[data-template="list"]')).toHaveCount(1)
 await expect(rows(page)).toHaveCount(2); await expect(page.locator('tbody [data-tone]')).toHaveCount(2)
 await page.getByRole('heading',{level:1}).click(); await page.keyboard.press('j'); await page.keyboard.press('Enter')
 await expect(page).toHaveURL(/\/subscription\/invoices\/inv-1/); await expectNoSecondH1(page)
 await expect(page.getByTestId('not-official')).toBeVisible(); const line=page.getByTestId('invoice-line').first()
 await expect(line).toContainText('× 3'); await expect(line.locator('bdi').nth(1)).toContainText('1'); await expect(line.locator('bdi').nth(2)).toContainText('3')
})
test('an unknown invoice shows the shared not found state without invoice data', async ({ page }) => {
 await open(page,'/subscription/invoices/nope'); await expect(page.locator('[data-slot="not-found-state"]')).toBeVisible(); await expect(page.getByTestId('invoice-line')).toHaveCount(0)
})
test('a customer without billing.read sees the forbidden state on the invoice list', async ({ page }) => {
 await open(page,'/subscription'); let intercepted=0
 await page.route('**/api/v1/me', async route=>{ const response=await route.fetch(); const value=await response.json(); intercepted++; await route.fulfill({json:{...value,capabilities:['access.users.read']}}) })
 await page.getByRole('link',{name:'كل الفواتير',exact:true}).click(); await expect.poll(()=>intercepted).toBeGreaterThan(0)
 await expect(page.locator('[data-slot="forbidden-state"]')).toBeVisible(); await expect(page.getByTestId('invoice-row')).toHaveCount(0)
})
test('on a 390px phone customer invoices retain ltr periods and fit the width', async ({ page }) => {
 await page.setViewportSize({width:390,height:844}); await open(page,'/subscription/invoices'); await expect(mobileRows(page)).toHaveCount(2)
 await expect(mobileRows(page).first().locator('bdi[dir="ltr"]')).toBeVisible(); expect(await fitsWidth(page)).toBe(true)
})
