import { readFile } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'

// Runs against the isolated synthetic stack (MODULE_UI_PREVIEW=1): sales-reports-mock-routes.mjs adds up the product lines of
// the Sales mock's own documents, so the report agrees with the list. Seed: S00002 and S00004 are the confirmed orders (the
// first by another salesperson, the second an online order nobody owns), S00001 a draft, S00003 cancelled, S00005 to S00008 sent.
// `mock_caps=no_sales_reports` takes the reports right away.
test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'the sales checks run on the isolated mock stack (npm run e2e:mock)')

async function login(page: Page) {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

const table = (page: Page) => page.getByTestId('sales-report-breakdown')
const bodyRows = (page: Page) => table(page).locator('tbody tr')

test.beforeEach(async ({ page }) => {
  await login(page)
  const reset = await page.request.post('/api/v1/public/sales/__mock/reset', { data: {} })
  expect(reset.ok()).toBe(true)
})

test('the report opens from the sidebar, shows the tiles and groups confirmed orders by month', async ({ page }) => {
  await page.goto('/sales')
  await page.getByRole('link', { name: 'تقارير المبيعات' }).first().click()
  await expect(page).toHaveURL(/\/sales\/reports$/)
  await expect(page.locator('main h1')).toHaveText('تقارير المبيعات')
  const tiles = page.getByTestId('sales-report-tiles')
  await expect(tiles).toContainText('الطلبات المؤكدة')
  await expect(tiles).toContainText('عروض الأسعار المفتوحة')
  await expect(tiles).toContainText('الملغاة')
  await expect(bodyRows(page)).toHaveCount(1)
  await expect(bodyRows(page).first()).toContainText('نوفمبر')
  await expect(bodyRows(page).first()).toContainText('2')
})

test('the dimension, the stage and the source live in the address, and Back and refresh keep them', async ({ page }) => {
  await page.goto('/sales/reports')
  await page.getByTestId('sales-report-by').getByText('العميل', { exact: true }).click()
  await expect(page).toHaveURL(/by=customer/)
  await expect(bodyRows(page)).toHaveCount(1)
  await expect(bodyRows(page).first()).toContainText('منى العتيبي')

  await page.getByTestId('sales-report-stage').getByText('الكل', { exact: true }).click()
  await expect(page).toHaveURL(/state=all/)
  await expect(bodyRows(page)).toHaveCount(3)
  await page.getByTestId('sales-report-source').click()
  await page.getByRole('option', { name: 'طلب إلكتروني' }).click()
  await expect(page).toHaveURL(/source=online/)
  await expect(bodyRows(page)).toHaveCount(1)
  const filtered = page.url()

  await page.reload()
  await expect(page).toHaveURL(filtered)
  await expect(bodyRows(page)).toHaveCount(1)
  await page.goBack()
  await expect(page).not.toHaveURL(/source=online/)
  await expect(page).toHaveURL(/state=all/)
  await expect(bodyRows(page)).toHaveCount(3)
})

test('a direct link keeps its range and period, and a range with nothing shows the empty state', async ({ page }) => {
  await page.goto('/sales/reports?by=period&period=day&from=2026-11-10&to=2026-11-12')
  await expect(bodyRows(page)).toHaveCount(2)
  await expect(page.getByTestId('sales-report-period')).toBeVisible()
  await page.goto('/sales/reports?from=2027-01-01')
  await expect(page.getByTestId('sales-report-empty')).toBeVisible()
  await expect(page.getByTestId('sales-report-tiles')).toContainText('0')
})

test('picking a salesperson narrows the report to that row and the chip takes it off again', async ({ page }) => {
  await page.goto('/sales/reports?by=salesperson')
  await expect(bodyRows(page)).toHaveCount(2)
  await expect(table(page)).toContainText('طلبات المتجر (بلا مندوب)')
  await page.getByTestId('sales-report-pick').first().click()
  await expect(page).toHaveURL(/salesperson=\d+/)
  await expect(page.getByTestId('sales-report-picked-salesperson')).toBeVisible()
  await expect(bodyRows(page)).toHaveCount(1)
  await page.getByTestId('sales-report-picked-salesperson').click()
  await expect(page).not.toHaveURL(/salesperson=/)
  await expect(bodyRows(page)).toHaveCount(2)
})

test('the export downloads the rows behind the filters as CSV', async ({ page }) => {
  await page.goto('/sales/reports?state=all')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('sales-report-export').click()])
  expect(download.suggestedFilename()).toMatch(/^sales-report-.*\.csv$/)
  const text = await readFile((await download.path())!, 'utf8')
  const [header, ...rows] = text.replace(/^﻿/, '').trim().split('\n')
  expect(header).toBe('number,date,state,source,customer,salesperson,product,quantity,unit_price,discount_percent,amount_untaxed,amount_total,currency')
  expect(rows.length).toBeGreaterThanOrEqual(6)
  expect(rows.some(row => row.includes(',cancelled,'))).toBe(true)
})

test('an export of more rows than one file carries names the limit and downloads nothing', async ({ page }) => {
  await page.goto('/sales/reports?state=all')
  await page.context().addCookies([{ name: 'mock_export', value: 'too_large', url: new URL(page.url()).origin }])
  await page.getByTestId('sales-report-export').click()
  await expect(page.getByText(/النتائج أكثر من .*50.*صف\. ضيّق التصفية ثم صدّر من جديد\./)).toBeVisible()
  await expect(page.getByTestId('sales-report-export')).toBeEnabled()
})

test('a session without the reports right is refused and the sidebar does not list the report', async ({ page }) => {
  await page.context().addCookies([{ name: 'mock_caps', value: 'no_sales_reports', url: new URL(page.url()).origin }])
  await page.goto('/sales/reports')
  await expect(page.getByTestId('sales-report-tiles')).toHaveCount(0)
  await expect(page.getByTestId('sales-report-export')).toHaveCount(0)
  await page.goto('/sales')
  await expect(page.getByTestId('sales-order-link').first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'تقارير المبيعات' })).toHaveCount(0)
})

test('the report reads right to left on a phone without a sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/sales/reports?by=customer')
  await expect(page.getByTestId('sales-report-tiles')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})
