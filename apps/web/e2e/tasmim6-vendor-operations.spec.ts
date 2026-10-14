import { expect, test } from '@playwright/test'
import { expectNoSecondH1, fitsWidth, login, mobileRows, open, rows } from './tasmim6-commercial-helpers'
test.beforeEach(async ({ page }) => { await login(page) })

test('the operations list keeps source, keyboard navigation and the return target', async ({ page }) => {
 await open(page,'/vendor/operations?source=all'); await expectNoSecondH1(page); await expect(rows(page)).toHaveCount(3)
 await expect(page.getByTestId('operation-row').first()).toHaveAttribute('href',/source=shared/)
 await page.getByRole('heading',{level:1}).click(); await page.keyboard.press('j'); await page.keyboard.press('Enter')
 await expect(page).toHaveURL(/op-1.*source=shared/); await expectNoSecondH1(page)
 await expect(page.locator('form')).toHaveCount(0)
 let refreshCalls=0; page.on('request',r=>{if(r.url().includes('/api/vendor/v1/operations/op-1')) refreshCalls++})
 await page.getByRole('button',{name:'تحديث',exact:true}).click(); await expect.poll(()=>refreshCalls).toBeGreaterThan(0)
 await page.locator('[data-slot="page-header"] a').first().click(); await expect(page).toHaveURL(/source=all/)
 await open(page,'/vendor/operations/op-2?source=legacy'); await expect(page.locator('form')).toHaveCount(1)
})
test('a tenant filter keeps page and audit pagination reaches the third page', async ({ page }) => {
 await open(page,'/vendor/operations?page=2'); await page.locator('[data-shortcut-search] input').fill('tenant-1')
 await expect.poll(()=>new URL(page.url()).searchParams.get('tenant_id')).toBe('tenant-1'); expect(new URL(page.url()).searchParams.get('page')).toBe('2')
 await open(page,'/vendor/audit'); await expect(rows(page)).toHaveCount(25)
 await page.getByRole('button',{name:'Next Page'}).click(); await expect(page).toHaveURL(/page=2/); await expect(rows(page)).toHaveCount(25); await page.getByRole('button',{name:'Next Page'}).click(); await expect(rows(page)).toHaveCount(10)
 await expect(page).toHaveURL(/page=3/); await expect(page.getByRole('main')).toContainText('custom.unknown_action')
})
test('on a 390px phone operations and audit fit without losing mobile rows', async ({ page }) => {
 await page.setViewportSize({width:390,height:844})
 for(const path of ['/vendor/operations','/vendor/audit']) { await open(page,path); await expect(mobileRows(page)).not.toHaveCount(0); expect(await fitsWidth(page)).toBe(true) }
})
