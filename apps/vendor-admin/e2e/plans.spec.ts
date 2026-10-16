import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { expectNoSecondH1, fitsWidth, login, mobileRows, open, rows } from './commercial-helpers'
test.beforeEach(async ({ page }) => { await login(page) })

test('the list is the list template with rows and the create button', async ({ page }) => {
 await open(page, '/plans'); await expectNoSecondH1(page)
 await expect(page.locator('[data-template="list"]')).toHaveCount(1); await expect(rows(page)).toHaveCount(2)
 await expect(page.getByTestId('vendor-plan-new')).toBeVisible()
 await page.getByTestId('vendor-plan-new').click()
 await expect(page).toHaveURL(/\/plans\/new/)
 expect(new URL(page.url()).searchParams.get('returnTo')).toContain('/plans')
})
test('J and K move between rows and Enter opens the record with its return target', async ({ page }) => {
 await open(page,'/plans'); await page.getByRole('heading',{level:1}).click(); await page.keyboard.press('j')
 await expect(rows(page).first()).toBeFocused(); await page.keyboard.press('j'); await page.keyboard.press('k'); await page.keyboard.press('Enter')
 await expect(page).toHaveURL(/\/plans\/00000000-0000-4000-8000-000000000010/); await expectNoSecondH1(page)
 await expect(page.locator('[data-template="record"]')).toHaveCount(1)
 expect(new URL(page.url()).searchParams.get('returnTo')).toContain('/plans')
})
test('on a 390px phone the rows keep their information and fit the width', async ({ page }) => {
 await page.setViewportSize({width:390,height:844}); await open(page,'/plans')
 await expect(mobileRows(page)).toHaveCount(2); await expect(page.locator('table')).toBeHidden(); expect(await fitsWidth(page)).toBe(true)
 await open(page,'/plans/00000000-0000-4000-8000-000000000010'); expect(await fitsWidth(page)).toBe(true)
})

test('the record keeps quote preview, lifecycle and the filtered back target', async ({ page }) => {
 await open(page,'/plans?status=published'); await expect(page.locator('[data-slot="lifecycle-badge"]:visible')).toHaveCount(1)
 await page.getByTestId('plan-row').filter({ visible: true }).click(); await expect(page.getByTestId('quote-preview')).toBeVisible(); await expect(page.getByTestId('lifecycle-panel')).toBeVisible()
 await page.locator('[data-slot="page-header"] a').first().click(); await expect(page).toHaveURL(/status=published/)
})

// LifecycleStatus is schema-limited and lifecycleBadge always returns a key today.
// Pin the typed fallback expression without inventing an invalid server fixture.
test('the lifecycle label fallback is the record status string', () => {
  const source = readFileSync(new URL('../app/pages/plans/index.vue', import.meta.url), 'utf8')
  const fallback = source.match(/:label="lifecycleBadge\(p\)\.labelKey \? t\(lifecycleBadge\(p\)\.labelKey\) : ([^"]+)"/)?.[1]
  expect(fallback).toBe('p.status')
})
