import { expect, test } from '@playwright/test'
import { expectNoSecondH1, fitsWidth, login, mobileRows, open, rows } from './commercial-helpers'
test.beforeEach(async ({ page }) => { await login(page) })

test('the operations list keeps source, keyboard navigation and the return target', async ({ page }) => {
 await open(page,'/operations?source=all'); await expectNoSecondH1(page); await expect(rows(page)).toHaveCount(3)
 await expect(page.getByTestId('operation-row').first()).toHaveAttribute('href',/source=shared/)
 await page.getByRole('heading',{level:1}).click(); await page.keyboard.press('j'); await page.keyboard.press('Enter')
 await expect(page).toHaveURL(/op-1.*source=shared/); await expectNoSecondH1(page)
 await expect(page.locator('form')).toHaveCount(0)
 let refreshCalls=0; page.on('request',r=>{if(r.url().includes('/api/vendor/v1/operations/op-1')) refreshCalls++})
 await page.getByRole('button',{name:'تحديث',exact:true}).click(); await expect.poll(()=>refreshCalls).toBeGreaterThan(0)
 await page.locator('[data-slot="page-header"] a').first().click(); await expect(page).toHaveURL(/source=all/)
 await open(page,'/operations/op-2?source=legacy'); await expect(page.locator('form')).toHaveCount(1)
})
test('the workspace filter is URL-backed and restarts at the first page; rows name the workspace', async ({ page }) => {
 await open(page,'/operations?page=2'); await expect(page.getByTestId('operation-target').first()).toContainText('نسخة')
 await page.getByRole('button',{name:'البحث والفلاتر'}).click(); await page.getByRole('combobox',{name:'نسخة العميل'}).click(); await page.getByRole('option',{name:'نسخة بيتا'}).click()
 await expect.poll(()=>new URL(page.url()).searchParams.get('tenant_id')).toBe('tenant-2'); expect(new URL(page.url()).searchParams.has('page')).toBe(false)
 await expect(rows(page)).toHaveCount(1); await expect(page.getByTestId('operations-result-count')).toBeVisible()
})
test('the audit log pages through to the third page and keeps unknown actions readable', async ({ page }) => {
 await open(page,'/audit'); await expect(rows(page)).toHaveCount(25)
 await page.getByRole('button',{name:'Next Page'}).click(); await expect(page).toHaveURL(/page=2/); await expect(rows(page)).toHaveCount(25); await page.getByRole('button',{name:'Next Page'}).click(); await expect(rows(page)).toHaveCount(10)
 await expect(page).toHaveURL(/page=3/); await expect(page.locator('#__nuxt')).toContainText('custom.unknown_action')
})
test('audit filters are applied by the server and live in the URL; subjects show names', async ({ page }) => {
 await open(page,'/audit?q=unknown'); await expect(rows(page)).toHaveCount(1); await expect(page.getByTestId('audit-result-count')).toBeVisible()
 await expect(rows(page).first()).toContainText('نسخة ألفا')
 await page.reload(); await expect(rows(page)).toHaveCount(1)
 await open(page,'/audit?action=operation'); await expect(rows(page)).toHaveCount(25)
})
test('on a 390px phone operations and audit fit without losing mobile rows', async ({ page }) => {
 await page.setViewportSize({width:390,height:844})
 for(const path of ['/operations','/audit']) { await open(page,path); await expect(mobileRows(page)).not.toHaveCount(0); expect(await fitsWidth(page)).toBe(true) }
})
