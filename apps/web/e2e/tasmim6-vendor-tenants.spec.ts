import { expect, test } from '@playwright/test'
import { expectNoSecondH1, fitsWidth, login, mobileRows, open, rows } from './tasmim6-commercial-helpers'
test.beforeEach(async ({ page }) => { await login(page) })

test('the list is the list template with rows and the create shortcut', async ({ page }) => {
 await open(page, '/vendor/tenants'); await expectNoSecondH1(page)
 await expect(page.locator('[data-template="list"]')).toHaveCount(1); await expect(rows(page)).toHaveCount(2)
 await expect(page.getByTestId('vendor-tenant-new')).toBeVisible()
 await page.getByRole('heading',{level:1}).click(); await page.keyboard.press('c')
 await expect(page).toHaveURL(/\/vendor\/tenants\/new/)
 expect(new URL(page.url()).searchParams.get('returnTo')).toContain('/vendor/tenants')
})
test('J and K move between rows and Enter opens the record with its return target', async ({ page }) => {
 await open(page,'/vendor/tenants'); await page.getByRole('heading',{level:1}).click(); await page.keyboard.press('j')
 await expect(rows(page).first()).toBeFocused(); await page.keyboard.press('j'); await page.keyboard.press('k'); await page.keyboard.press('Enter')
 await expect(page).toHaveURL(/\/vendor\/tenants\/tenant-1/); await expectNoSecondH1(page)
 await expect(page.locator('[data-template="record"]')).toHaveCount(1)
 expect(new URL(page.url()).searchParams.get('returnTo')).toContain('/vendor/tenants')
})
test('on a 390px phone the rows keep their information and fit the width', async ({ page }) => {
 await page.setViewportSize({width:390,height:844}); await open(page,'/vendor/tenants')
 await expect(mobileRows(page)).toHaveCount(2); await expect(page.locator('table')).toBeHidden(); expect(await fitsWidth(page)).toBe(true)
 await open(page,'/vendor/tenants/tenant-1'); expect(await fitsWidth(page)).toBe(true)
})

test('the record keeps the allowed operations and revoke confirmation inline', async ({ page }) => {
 await open(page,'/vendor/tenants/tenant-1'); await expectNoSecondH1(page)
 await expect(page.locator('[data-slot="record-aside"]')).toContainText('target-tenant-1')
 await page.getByRole('combobox').click(); await expect(page.getByRole('option')).toHaveCount(2)
 await expect(page.getByRole('option')).toContainText(['فحص نسخة','فحص الصحة']); await page.keyboard.press('Escape')
 await page.getByRole('button',{name:'تعطيل العمليات'}).click(); await expect(page.getByTestId('inline-confirm')).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0)
})
