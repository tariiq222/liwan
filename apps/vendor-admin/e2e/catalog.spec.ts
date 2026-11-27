import { expect, test } from '@playwright/test'
import { expectNoSecondH1, fitsWidth, hydrated, login, mobileRows, navigateClient, open, RESTRICTED_EMAIL, rows } from './commercial-helpers'

const DRAFT = '00000000-0000-4000-8000-000000000401'
const PUBLISHED = 'cat-1'
const PMO_BUNDLE = '00000000-0000-4000-8000-000000000020'
const PMO_BUNDLE_V2 = '00000000-0000-4000-8000-000000000022'
const HR_BUNDLE = '00000000-0000-4000-8000-000000000021'

test.beforeEach(async ({ page }) => { await login(page) })

test('the tabs follow the order a customer meets them: plans, add-ons, applications', async ({ page }) => {
  await open(page, '/catalog'); await expectNoSecondH1(page)
  const tabs = page.locator('[data-testid^="catalog-tab-"]')
  await expect(tabs).toHaveCount(3)
  expect(await tabs.evaluateAll(items => items.map(item => item.getAttribute('data-testid')))).toEqual(['catalog-tab-plans', 'catalog-tab-addons', 'catalog-tab-catalog'])
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
  await expect(page.getByTestId('catalog-next-step').getByRole('link')).toHaveAttribute('href', '/addons/new')
})

test('a draft version record says a new import validates it and offers no action', async ({ page }) => {
  await open(page, `/catalog/releases/${DRAFT}`)
  await expect(page.getByTestId('catalog-legacy-draft')).toBeVisible()
  await expect(page.getByTestId('catalog-action')).toHaveCount(0)
  await expect(page.getByTestId('catalog-action-submit')).toHaveCount(0)
})

const bundleFixture = (id: string, appId: string, overrides: Record<string, unknown> = {}) => ({
  id,
  version: 1,
  edit_revision: 1,
  name: appId === 'pmo' ? 'الحزمة الأساسية' : 'حزمة الموارد',
  status: 'draft',
  available: false,
  audience: { kind: 'public' },
  prices: [{ cadence: { unit: 'month', count: 1 }, amount: { currency: 'SAR', exponent: 2, minor: 5000 } }],
  bundle_id: appId === 'pmo' ? 'bundle-core' : 'bundle-hr',
  description: appId === 'pmo' ? 'الحزمة الأساسية' : 'حزمة الموارد',
  catalog_release_id: '00000000-0000-4000-8000-000000000100',
  selections: [{ app_id: appId, feature_keys: [`${appId}.enabled`] }],
  domain_limits: {},
  content_digest: 'c'.repeat(64),
  validated_digest: null,
  customer_count: 0,
  created_at: '2026-10-01T08:00:00.000Z',
  published_at: null,
  issues: [],
  ...overrides,
})

test('an application records its add-on price and edits a published add-on inline via revisions, patch, validate, publish', async ({ page }) => {
  const calls: string[] = []
  await page.route('**/api/vendor/v1/commercial/bundles/**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    if (req.method() === 'POST' && path === `/api/vendor/v1/commercial/bundles/${PMO_BUNDLE}/revisions`) {
      calls.push('revisions')
      return route.fulfill({ status: 201, json: bundleFixture(PMO_BUNDLE_V2, 'pmo', { version: 2, edit_revision: 1, status: 'draft' }) })
    }
    if (req.method() === 'PATCH' && path === `/api/vendor/v1/commercial/bundles/${PMO_BUNDLE_V2}`) {
      calls.push('PATCH')
      return route.fulfill({ json: bundleFixture(PMO_BUNDLE_V2, 'pmo', { version: 2, edit_revision: 2, status: 'draft' }) })
    }
    if (req.method() === 'POST' && path === `/api/vendor/v1/commercial/bundles/${PMO_BUNDLE_V2}/validate`) {
      calls.push('validate')
      return route.fulfill({ json: bundleFixture(PMO_BUNDLE_V2, 'pmo', { version: 2, edit_revision: 3, status: 'validated', validated_digest: 'c'.repeat(64) }) })
    }
    if (req.method() === 'POST' && path === `/api/vendor/v1/commercial/bundles/${PMO_BUNDLE_V2}/publish`) {
      calls.push('publish')
      return route.fulfill({ json: bundleFixture(PMO_BUNDLE_V2, 'pmo', { version: 2, edit_revision: 4, status: 'published', available: true, validated_digest: 'c'.repeat(64), published_at: '2026-11-27T08:00:00.000Z' }) })
    }
    return route.fallback()
  })
  await open(page, '/catalog/apps/pmo'); await expectNoSecondH1(page); await hydrated(page)
  await expect(page.locator('[data-template="record"]')).toHaveCount(1)
  await expect(page.getByTestId('catalog-app-features')).toBeVisible()
  await expect(page.getByTestId('catalog-app-bundle-link')).toHaveCount(1)
  await expect(page.getByTestId('catalog-app-addon-price')).toContainText(/50\.00/)
  await page.getByTestId('catalog-app-settings').click()
  await expect(page.getByTestId('catalog-app-pricing-editor')).toBeVisible()
  await page.getByTestId('catalog-app-pricing-reason').fill('Adjust PMO add-on price')
  await page.getByTestId('catalog-app-pricing-submit').click()
  await expect.poll(() => calls).toEqual(['revisions', 'PATCH', 'validate', 'publish'])
})

test('an editable draft add-on saves inline via patch, validate, publish', async ({ page }) => {
  const calls: string[] = []
  await page.route('**/api/vendor/v1/commercial/bundles/**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    if (req.method() === 'PATCH' && path === `/api/vendor/v1/commercial/bundles/${HR_BUNDLE}`) {
      calls.push('PATCH')
      return route.fulfill({ json: bundleFixture(HR_BUNDLE, 'hr', { edit_revision: 2, status: 'draft' }) })
    }
    if (req.method() === 'POST' && path === `/api/vendor/v1/commercial/bundles/${HR_BUNDLE}/validate`) {
      calls.push('validate')
      return route.fulfill({ json: bundleFixture(HR_BUNDLE, 'hr', { edit_revision: 3, status: 'validated', validated_digest: 'c'.repeat(64) }) })
    }
    if (req.method() === 'POST' && path === `/api/vendor/v1/commercial/bundles/${HR_BUNDLE}/publish`) {
      calls.push('publish')
      return route.fulfill({ json: bundleFixture(HR_BUNDLE, 'hr', { edit_revision: 4, status: 'published', available: true, validated_digest: 'c'.repeat(64), published_at: '2026-11-27T08:00:00.000Z' }) })
    }
    return route.fallback()
  })
  await open(page, '/catalog/apps/hr'); await hydrated(page)
  await page.getByTestId('catalog-app-settings').click()
  await expect(page.getByTestId('catalog-app-pricing-editor')).toBeVisible()
  await page.getByTestId('catalog-app-pricing-reason').fill('Publish HR add-on price')
  await page.getByTestId('catalog-app-pricing-submit').click()
  await expect.poll(() => calls).toEqual(['PATCH', 'validate', 'publish'])
})

test('an application with no add-on says so and opens a new add-on on that application', async ({ page }) => {
  await open(page, '/catalog/apps/growth')
  await expect(page.getByTestId('catalog-app-addon-price')).toHaveText('لا توجد إضافة')
  const settings = page.getByTestId('catalog-app-settings')
  await expect(settings).toHaveAttribute('href', /\/addons\/new\?app=growth&returnTo=/)
  await settings.click()
  await expect(page).toHaveURL(/\/addons\/new\?/)
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/catalog/apps/growth')
})

test('a new add-on opened with an application starts on that selection with the booleans it grants', async ({ page }) => {
  await open(page, '/addons/new?app=meetings&returnTo=%2Fcatalog%2Fapps%2Fmeetings')
  await expect(page.getByTestId('bundle-form')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'الاجتماعات' })).toBeChecked()
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/catalog/apps/meetings')
})

test('a new add-on opened without an application starts empty', async ({ page }) => {
  await open(page, '/addons/new')
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
