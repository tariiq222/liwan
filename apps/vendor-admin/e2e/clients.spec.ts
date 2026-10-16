import { expect, test } from '@playwright/test'
import { expectNoSecondH1, fitsWidth, login, navigateClient, open, rows } from './commercial-helpers'
test.beforeEach(async ({ page }) => { await login(page) })

test('the client list creates a client under customers and carries its return target', async ({ page }) => {
 await open(page, '/customers'); await expectNoSecondH1(page)
 await expect(page.locator('[data-template="list"]')).toHaveCount(1)
 await expect(page.getByTestId('vendor-customer-new')).toBeVisible()
 await page.getByTestId('vendor-customer-new').click()
 await expect(page).toHaveURL(/\/customers\/new/)
 expect(new URL(page.url()).searchParams.get('returnTo')).toContain('/customers')
})

test('a workspace with a customer opens that customer on the workspace tab', async ({ page }) => {
 await page.goto('/tenants/tenant-1')
 await expect.poll(() => new URL(page.url()).pathname).toBe('/customers/cust-alpha')
 expect(new URL(page.url()).searchParams.get('tab')).toBe('workspace')
 await expect(page.getByTestId('customer-tab-workspace')).toHaveAttribute('aria-current', 'page')
})

test('the customer tabs live in the URL and survive a refresh', async ({ page }) => {
 await open(page, '/customers/cust-alpha'); await expectNoSecondH1(page)
 await expect(page.getByTestId('customer-tab-summary')).toHaveAttribute('aria-current', 'page')
 await page.getByTestId('customer-tab-history').click()
 await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe('history')
 await page.reload()
 await expect(page.getByTestId('customer-tab-history')).toHaveAttribute('aria-current', 'page')
 await page.goBack()
 await expect(page.getByTestId('customer-tab-summary')).toHaveAttribute('aria-current', 'page')
})

test('a customer without a workspace says none is set up on the workspace and operations tabs', async ({ page }) => {
 for (const tab of ['workspace', 'operations']) {
  await open(page, `/customers/cust-gamma?tab=${tab}`)
  await expect(page.getByText('لم تُجهَّز مساحة عمل بعد')).toBeVisible()
 }
})

test('the operations tab keeps the allowed operations and revoke confirmation inline', async ({ page }) => {
 await open(page, '/customers/cust-alpha?tab=operations'); await expectNoSecondH1(page)
 await page.getByRole('combobox').click(); await expect(page.getByRole('option')).toHaveCount(2)
 await expect(page.getByRole('option')).toContainText(['فحص نسخة','فحص الصحة']); await page.keyboard.press('Escape')
 await page.getByRole('button',{name:'تعطيل العمليات'}).click(); await expect(page.getByTestId('inline-confirm')).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('the summary shows the workspace properties', async ({ page }) => {
 await open(page, '/customers/cust-alpha')
 await expect(page.locator('[data-slot="properties-panel"]').filter({ hasText: 'target-tenant-1' })).toBeVisible()
})

test('a workspace without a customer keeps its own page with the summary, workspace and operations tabs', async ({ page }) => {
 await open(page, '/overview')
 await page.route('**/api/vendor/v1/commercial/customers**', route => route.fulfill({ json: { items: [], total: 0 } }))
 await navigateClient(page, '/tenants/tenant-1'); await expectNoSecondH1(page)
 await expect(page).toHaveURL(/\/tenants\/tenant-1/)
 await expect(page.locator('[data-template="record"]')).toHaveCount(1)
 await expect(page.locator('[data-slot="record-tabs"] a')).toHaveCount(3)
})

test('on a 390px phone the rows keep their information and fit the width', async ({ page }) => {
 await page.setViewportSize({width:390,height:844}); await open(page,'/customers')
 await expect(rows(page).first()).toBeAttached(); await expect(page.locator('table')).toBeHidden(); expect(await fitsWidth(page)).toBe(true)
 await open(page,'/customers/cust-alpha?tab=operations'); expect(await fitsWidth(page)).toBe(true)
})
