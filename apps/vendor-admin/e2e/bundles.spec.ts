import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { expectNoSecondH1, fitsWidth, login, mobileRows, navigateClient, open, rows } from './commercial-helpers'
test.beforeEach(async ({ page }) => { await login(page) })

test('the list is the list template with rows and the create button', async ({ page }) => {
 await open(page, '/bundles'); await expectNoSecondH1(page)
 await expect(page.locator('[data-template="list"]')).toHaveCount(1); await expect(rows(page)).toHaveCount(2)
 await expect(page.getByTestId('vendor-bundle-new')).toBeVisible()
 await page.getByTestId('vendor-bundle-new').click()
 await expect(page).toHaveURL(/\/bundles\/new/)
 expect(new URL(page.url()).searchParams.get('returnTo')).toContain('/bundles')
})
test('J and K move between rows and Enter opens the record with its return target', async ({ page }) => {
 await open(page,'/bundles'); await page.getByRole('heading',{level:1}).click(); await page.keyboard.press('j')
 await expect(rows(page).first()).toBeFocused(); await page.keyboard.press('j'); await page.keyboard.press('k'); await page.keyboard.press('Enter')
 await expect(page).toHaveURL(/\/bundles\/00000000-0000-4000-8000-000000000020/); await expectNoSecondH1(page)
 await expect(page.locator('[data-template="record"]')).toHaveCount(1)
 expect(new URL(page.url()).searchParams.get('returnTo')).toContain('/bundles')
})
test('on a 390px phone the rows keep their information and fit the width', async ({ page }) => {
 await page.setViewportSize({width:390,height:844}); await open(page,'/bundles')
 await expect(mobileRows(page)).toHaveCount(2); await expect(page.locator('table')).toBeHidden(); expect(await fitsWidth(page)).toBe(true)
 await open(page,'/bundles/00000000-0000-4000-8000-000000000020'); expect(await fitsWidth(page)).toBe(true)
})

test('bundle history keeps returnTo and the retired catalog is read only', async ({ page }) => {
 await open(page,'/bundles/00000000-0000-4000-8000-000000000020?returnTo=%2Fbundles%3Fstatus%3Dpublished')
 await expect(page.locator('[data-slot="entitlement-summary"]')).toBeVisible()
 const history=page.locator('[data-slot="record-section"]').filter({has:page.getByRole('heading',{name:'السجل'})})
 await expect(history.locator('a').first()).toHaveAttribute('href',/returnTo=/)
 await open(page,'/packages'); await expect(rows(page)).toHaveCount(2); await expect(page.locator('[data-shortcut-create]')).toHaveCount(0)
 await rows(page).first().locator('a').first().click(); await expectNoSecondH1(page); await expect(page.locator('[data-template="record"]')).toHaveCount(1)
 await page.setViewportSize({width:390,height:844}); await open(page,'/packages'); await expect(mobileRows(page)).toHaveCount(2); expect(await fitsWidth(page)).toBe(true)
})

const RELEASE = '00000000-0000-4000-8000-000000000100'

test('a new bundle asks for the catalog version from the published ones and creates the release from it', async ({ page }) => {
 await open(page, '/overview')
 let created: { catalog_version?: string, reason?: string } | undefined
 const release = { id: RELEASE, version: '2026.10', applications: [], base_modules: [], source_digest: 'a'.repeat(64), artifact_digest: 'b'.repeat(64) }
 await page.route('**/api/vendor/v1/commercial/catalog/releases', async route => {
  if (route.request().method() === 'POST') { created = route.request().postDataJSON(); return route.fulfill({ status: 201, json: release }) }
  return route.fulfill({ json: created ? { items: [release], total: 1 } : { items: [], total: 0 } })
 })
 await navigateClient(page, '/bundles/new')
 const form = page.getByTestId('release-create'); await expect(form).toBeVisible()
 const version = page.getByTestId('release-version'); await expect(version).toContainText('2026.10')
 await form.getByRole('textbox').fill('Start the first bundle'); await form.locator('button[type="submit"]').click()
 await expect.poll(() => created).toEqual({ catalog_version: '2026.10', reason: 'Start the first bundle' })
 await expect(page.getByTestId('release-create')).toHaveCount(0)
})

test('without a published catalog version a new bundle says to publish one first and offers no form', async ({ page }) => {
 await open(page, '/overview')
 await page.route('**/api/vendor/v1/commercial/catalog/releases', route => route.fulfill({ json: { items: [], total: 0 } }))
 await page.route('**/api/vendor/v1/catalog', route => route.fulfill({ json: { items: [{ id: '00000000-0000-4000-8000-000000000401', version: '2026.12', status: 'draft', created_at: '2026-11-10T08:00:00Z', solution: { tiers: [] } }], total: 1 } }))
 await navigateClient(page, '/bundles/new')
 const alert = page.getByTestId('no-published-catalog'); await expect(alert).toBeVisible()
 await expect(page.getByTestId('release-create')).toHaveCount(0); await expect(page.locator('form')).toHaveCount(0)
 await alert.getByRole('link').click(); await expect(page).toHaveURL(/\/catalog$/)
})

// LifecycleStatus is schema-limited and lifecycleBadge always returns a key today.
// Pin the typed fallback expression without inventing an invalid server fixture.
test('the lifecycle label fallback is the record status string', () => {
  const source = readFileSync(new URL('../app/pages/bundles/index.vue', import.meta.url), 'utf8')
  const fallback = source.match(/:label="lifecycleBadge\(b\)\.labelKey \? t\(lifecycleBadge\(b\)\.labelKey\) : ([^"]+)"/)?.[1]
  expect(fallback).toBe('b.status')
})
