import { expect, test } from '@playwright/test'
import { expectNoSecondH1, fitsWidth, login, mobileRows, navigateClient, open, RESTRICTED_EMAIL, rows } from './commercial-helpers'

const DRAFT = '00000000-0000-4000-8000-000000000401'
const VALIDATED = '00000000-0000-4000-8000-000000000402'
const PUBLISHED = 'cat-1'
const PMO_BUNDLE = '00000000-0000-4000-8000-000000000020'
const HR_BUNDLE = '00000000-0000-4000-8000-000000000021'

test.beforeEach(async ({ page }) => { await login(page) })

test('the tabs follow the order a customer meets them: plans, add-ons, applications', async ({ page }) => {
  await open(page, '/catalog'); await expectNoSecondH1(page)
  const tabs = page.locator('[data-testid^="catalog-tab-"]')
  await expect(tabs).toHaveCount(3)
  expect(await tabs.evaluateAll(items => items.map(item => item.getAttribute('data-testid')))).toEqual(['catalog-tab-plans', 'catalog-tab-bundles', 'catalog-tab-catalog'])
  await expect(page.getByTestId('catalog-tab-catalog')).toHaveAttribute('aria-current', 'page')
  await page.getByTestId('catalog-tab-plans').click(); await expect(page).toHaveURL(/\/plans$/)
})

test('the catalog lists the applications of the current published version', async ({ page }) => {
  await open(page, '/catalog')
  await expect(page.locator('[data-template="list"]')).toHaveCount(1); await expect(rows(page)).toHaveCount(4)
  await expect(page.locator('[data-shortcut-create]')).toHaveCount(0)
  await expect(page.getByTestId('catalog-steps')).toHaveCount(0)
  await expect(page.locator('tbody [data-testid="catalog-app-row"]')).toHaveCount(4)
  await expect(page.getByTestId('catalog-app-sellable')).toHaveCount(4)
  await expect(page.locator('tbody [data-testid="catalog-app-row"]').first()).toHaveText('النمو')
  await page.setViewportSize({ width: 390, height: 844 }); await open(page, '/catalog')
  await expect(mobileRows(page)).toHaveCount(4); await expect(page.locator('table')).toBeHidden(); expect(await fitsWidth(page)).toBe(true)
})

test('an unpublished current version says so and links to the releases timeline', async ({ page }) => {
  await open(page, '/overview')
  await page.route('**/api/vendor/v1/catalog', route => route.fulfill({ json: { items: [{ id: DRAFT, version: '2026.12', status: 'draft', created_at: '2026-11-10T08:00:00Z', solution: { tiers: [{ id: 'pmo', name: 'المشاريع', sellable: true }] } }], total: 1 } }))
  await navigateClient(page, '/catalog')
  const alert = page.getByTestId('catalog-not-published'); await expect(alert).toBeVisible()
  await alert.getByRole('link').click(); await expect(page).toHaveURL(/\/catalog\/releases$/)
})

test('the releases timeline lists every import with its changes and opens the version record', async ({ page }) => {
  await open(page, '/catalog/releases'); await expectNoSecondH1(page)
  await expect(rows(page)).toHaveCount(3)
  await expect(page.locator('tbody [data-testid="catalog-row"]')).toHaveCount(3)
  await expect(page.locator('tbody [data-testid="catalog-row"]').first()).toHaveAttribute('href', `/catalog/releases/${DRAFT}`)
  await expect(rows(page).first()).toContainText('2026.12')
  await expect(page.locator('tbody [data-testid="catalog-legacy-draft"]')).toHaveCount(1)
  await expect(page.getByTestId('catalog-action')).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 }); await open(page, '/catalog/releases')
  await expect(mobileRows(page)).toHaveCount(3); await expect(page.locator('table')).toBeHidden(); expect(await fitsWidth(page)).toBe(true)
})

test('the releases table fits its card at 1440px, so the last change chip is never clipped', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await open(page, '/catalog/releases')
  const scroller = page.locator('.liwan-table-frame [data-slot="root"]')
  await expect(scroller).toBeVisible()
  // The table's own scroller, not the page: a positive overflow is the clipped inline-end edge the compact columns remove.
  await expect.poll(() => scroller.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
  const chips = page.getByTestId('catalog-diff-chips').first()
  await expect(chips).toBeVisible()
  const clipped = await chips.evaluate((el) => {
    const frame = el.closest('.liwan-table-frame')!.getBoundingClientRect()
    const chip = el.getBoundingClientRect()
    return chip.right > frame.right + 1 || chip.left < frame.left - 1
  })
  expect(clipped).toBe(false)
})

test('a version record is read-only: its applications and changes, with no approve or publish form', async ({ page }) => {
  await open(page, `/catalog/releases/${PUBLISHED}`); await expectNoSecondH1(page)
  await expect(page.locator('[data-template="record"]')).toHaveCount(1)
  await expect(page.getByTestId('catalog-app')).toHaveCount(4)
  await expect(page.getByTestId('catalog-sellable')).toHaveCount(4)
  await expect(page.getByTestId('catalog-changes')).toBeVisible()
  await expect(page.getByTestId('catalog-action')).toHaveCount(0)
  await expect(page.getByTestId('catalog-action-submit')).toHaveCount(0)
  await expect(page.getByTestId('catalog-release-form')).toHaveCount(0)
  await expect(page.getByTestId('catalog-next-step').getByRole('link')).toHaveAttribute('href', '/bundles/new')
})

test('a draft version record says a new import validates it and offers no action', async ({ page }) => {
  await open(page, `/catalog/releases/${DRAFT}`)
  await expect(page.getByTestId('catalog-legacy-draft')).toBeVisible()
  await expect(page.getByTestId('catalog-action')).toHaveCount(0)
  await expect(page.getByTestId('catalog-action-submit')).toHaveCount(0)
})

test('an application records its add-on price and opens the published add-on record for a new revision', async ({ page }) => {
  await open(page, '/catalog/apps/pmo'); await expectNoSecondH1(page)
  await expect(page.locator('[data-template="record"]')).toHaveCount(1)
  await expect(page.getByTestId('catalog-app-features')).toBeVisible()
  await expect(page.getByTestId('catalog-app-bundle-link')).toHaveCount(1)
  await expect(page.getByTestId('catalog-app-addon-price')).toContainText(/50\.00/)
  const settings = page.getByTestId('catalog-app-settings')
  await expect(settings).toHaveText('إصدار جديد')
  await expect(settings).toHaveAttribute('href', new RegExp(`/bundles/${PMO_BUNDLE}\\?returnTo=`))
})

test('an editable add-on opens its own form rather than a read-only record', async ({ page }) => {
  await open(page, '/catalog/apps/hr')
  const settings = page.getByTestId('catalog-app-settings')
  await expect(settings).toHaveText('إعدادات')
  await expect(settings).toHaveAttribute('href', new RegExp(`/bundles/${HR_BUNDLE}/edit\\?returnTo=`))
})

test('an application with no add-on says so and opens a new add-on on that application', async ({ page }) => {
  await open(page, '/catalog/apps/growth')
  await expect(page.getByTestId('catalog-app-addon-price')).toHaveText('لا توجد إضافة')
  const settings = page.getByTestId('catalog-app-settings')
  await expect(settings).toHaveAttribute('href', /\/bundles\/new\?app=growth&returnTo=/)
  await settings.click()
  await expect(page).toHaveURL(/\/bundles\/new\?/)
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/catalog/apps/growth')
})

test('a new add-on opened with an application starts on that selection with the booleans it grants', async ({ page }) => {
  await open(page, '/bundles/new?app=meetings&returnTo=%2Fcatalog%2Fapps%2Fmeetings')
  await expect(page.getByTestId('bundle-form')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'الاجتماعات' })).toBeChecked()
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/catalog/apps/meetings')
})

test('a new add-on opened without an application starts empty', async ({ page }) => {
  await open(page, '/bundles/new')
  await expect(page.getByTestId('bundle-form')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'الاجتماعات' })).not.toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'المشاريع' })).not.toBeChecked()
})

test('a read-only account sees the version record but no form to take a step', async ({ page }) => {
  await login(page, RESTRICTED_EMAIL)
  await open(page, `/catalog/releases/${DRAFT}`)
  await expect(page.getByTestId('catalog-legacy-draft')).toBeVisible()
  await expect(page.getByTestId('catalog-action-form')).toHaveCount(0)
})
