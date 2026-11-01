import { expect, test } from '@playwright/test'
import { expectNoSecondH1, fitsWidth, login, mobileRows, open, rows } from './tasmim6-commercial-helpers'
test.beforeEach(async ({ page }) => { await login(page) })

test('subscription settings keep plan usage branches invoices and explicit auto renew consent', async ({ page }) => {
 await open(page,'/subscription'); await expectNoSecondH1(page)
 await expect(page.locator('[data-slot="record-section"]')).toHaveCount(7)
 await expect(page.getByTestId('usage-metric')).toHaveCount(2); await expect(page.getByTestId('usage-metric').filter({has:page.locator('[data-known="false"]')})).toHaveCount(0)
 await expect(page.locator('[data-testid="usage-metric"][data-known="false"]')).toHaveCount(1)
 await expect(page.getByTestId('branch-row')).toHaveCount(1); await expect(page.locator('a[href^="/subscription/invoices/inv-"]')).toHaveCount(2)
 const control=page.locator('[data-slot="auto-renew"]'); await expect(control.getByRole('button')).toBeDisabled()
 await control.getByRole('checkbox').check(); await expect(control.getByRole('button')).toBeEnabled()
})
test('an order that is no longer pending shows its note and never posts an order', async ({ page }) => {
 const orders:string[]=[]; page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/commercial/v1/orders'))orders.push(r.url())})
 await open(page,'/subscription/status?order=order-x'); await expect(page.getByRole('main')).toContainText('هذا الطلب لم يعد معلّقًا.'); expect(orders).toEqual([])
})
test('branches are read only without branches.manage', async ({ page }) => {
 await open(page,'/subscription'); let intercepted=0
 await page.route('**/api/v1/me',async route=>{const response=await route.fetch();const value=await response.json();intercepted++;await route.fulfill({json:{...value,capabilities:['access.users.read']}})})
 await page.getByRole('link',{name:'الفروع',exact:true}).click(); await expect.poll(()=>intercepted).toBeGreaterThan(0)
 await expect(page.getByRole('link',{name:'إضافة فرع'})).toHaveCount(0)
})
test('the new branch opens a closeable create panel and subscription pages fit the phone', async ({ page }) => {
 await open(page,'/subscription/branches/new'); await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.getByRole('dialog')).toBeVisible()
 await page.getByRole('button',{name:'إغلاق',exact:true}).click(); await expect(page.getByRole('dialog')).toHaveCount(0)
 await page.setViewportSize({width:390,height:844})
 for(const path of ['/subscription','/subscription/status?order=order-x','/subscription/branches','/subscription/change','/subscription/branches/new']) {await open(page,path);expect(await fitsWidth(page)).toBe(true)}
})
