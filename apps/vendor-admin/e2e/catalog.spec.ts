import { expect, test } from '@playwright/test'
import { expectNoSecondH1, fitsWidth, login, mobileRows, navigateClient, open, RESTRICTED_EMAIL, rows } from './commercial-helpers'

// The fixture versions, newest import first: 2026.12 and 2026.10 are published (2026.12 adds the HR application and
// raises a project limit over 2026.10), and 2026.09 is validated, so it can still be published.
const CURRENT = '00000000-0000-4000-8000-000000000401'
const PUBLISHED = 'cat-1'
const VALIDATED = '00000000-0000-4000-8000-000000000402'
// The timeline's columns: version, status, imported, published, duration, age, changes.
const STATUS = 1
const IMPORTED = 2
const PUBLISHED_AT = 3
const DURATION = 4
const AGE = 5

test.beforeEach(async ({ page }) => { await login(page) })

test('the four tabs follow the build order and each list marks its own tab', async ({ page }) => {
  await open(page, '/catalog'); await expectNoSecondH1(page)
  const tabs = page.locator('[data-testid^="catalog-tab-"]')
  await expect(tabs).toHaveCount(4)
  expect(await tabs.evaluateAll(items => items.map(item => item.getAttribute('data-testid'))))
    .toEqual(['catalog-tab-catalog', 'catalog-tab-releases', 'catalog-tab-bundles', 'catalog-tab-plans'])
  await expect(page.getByTestId('catalog-tab-catalog')).toHaveAttribute('aria-current', 'page')
  await page.getByTestId('catalog-tab-releases').click(); await expect(page).toHaveURL(/\/catalog\/releases$/)
  await expect(page.getByTestId('catalog-tab-releases')).toHaveAttribute('aria-current', 'page')
  await page.getByTestId('catalog-tab-bundles').click(); await expect(page).toHaveURL(/\/bundles$/)
  await expect(page.getByTestId('catalog-tab-bundles')).toHaveAttribute('aria-current', 'page')
  await page.getByTestId('catalog-tab-plans').click(); await expect(page).toHaveURL(/\/plans$/)
})

test('the applications list is the offer of the current published version', async ({ page }) => {
  await open(page, '/catalog')
  await expect(page.locator('[data-template="list"]')).toHaveCount(1)
  await expect(rows(page)).toHaveCount(3)
  await expect(page.locator('[data-shortcut-create]')).toHaveCount(0)
  await expect(page.getByTestId('catalog-not-published')).toHaveCount(0)
  const table = page.locator('tbody')
  await expect(table.getByTestId('catalog-app-row')).toHaveCount(3)
  // Each application of the version is a row that opens its own record.
  for (const id of ['core', 'pmo', 'hr']) {
    await expect(table.locator(`a[data-testid="catalog-app-row"][href="/catalog/apps/${id}"]`)).toHaveCount(1)
  }
  // The always-included core is listed but never sold; HR and Projects are.
  await expect(table.getByTestId('catalog-app-sellable')).toHaveCount(2)
  await page.setViewportSize({ width: 390, height: 844 }); await open(page, '/catalog')
  await expect(mobileRows(page)).toHaveCount(3); await expect(page.locator('table')).toBeHidden(); expect(await fitsWidth(page)).toBe(true)
})

test('an import with no published version lists its applications behind a not-for-sale banner', async ({ page }) => {
  await open(page, '/overview')
  const onlyValidated = {
    id: VALIDATED, version: '2026.09', status: 'validated', created_at: '2026-09-01T08:00:00.000Z',
    published_at: null, imported_by: 'operator', published_by: null,
    solution: { base_modules: ['liwan_core'], tiers: [{ id: 'core', name: 'الأساس', modules: ['liwan_core'], features: [], sellable: false }] },
  }
  await page.route('**/api/vendor/v1/catalog', route => route.fulfill({ json: { items: [onlyValidated], total: 1 } }))
  await navigateClient(page, '/catalog')
  await expect(page.getByTestId('catalog-not-published')).toBeVisible()
  await expect(rows(page)).toHaveCount(1)
  await page.getByTestId('catalog-not-published').getByRole('link').click()
  await expect(page).toHaveURL(/\/catalog\/releases$/)
})

test('the timeline shows every version with its status, its dates, its duration and its change chips', async ({ page }) => {
  await open(page, '/catalog/releases'); await expectNoSecondH1(page)
  await expect(page.locator('[data-template="list"]')).toHaveCount(1)
  const list = rows(page); await expect(list).toHaveCount(3)
  const current = list.nth(0); const previous = list.nth(1); const validated = list.nth(2)
  await expect(current).toContainText('2026.12'); await expect(previous).toContainText('2026.10'); await expect(validated).toContainText('2026.09')
  await expect(current.locator('td').nth(STATUS)).toHaveText('منشورة ومتاحة')
  await expect(previous.locator('td').nth(STATUS)).toHaveText('منشورة ومتاحة')
  await expect(validated.locator('td').nth(STATUS)).toHaveText('جاهزة للاعتماد')
  // The validated import has no publish yet: the row offers it and shows no age.
  await expect(validated.getByTestId('catalog-approve')).toBeVisible()
  await expect(validated.locator('td').nth(PUBLISHED_AT).getByTestId('catalog-approve')).toHaveCount(1)
  // Who imported and who published, and how long the version took to go out (2026.12: eight days).
  await expect(current.locator('td').nth(IMPORTED)).toContainText('operator')
  await expect(current.locator('td').nth(PUBLISHED_AT)).toContainText('Vendor Admin')
  await expect(current.locator('td').nth(DURATION)).toHaveText(/8/)
  await expect(current.locator('td').nth(AGE)).toHaveText(/\d/)
  await expect(validated.locator('td').nth(AGE)).toHaveText('—')
  await expect(validated.locator('td').nth(DURATION)).toHaveText(/\d/)
  // 2026.12 adds an application, its feature and a raised limit over 2026.10; 2026.10 only raises the limit.
  await expect(current.getByTestId('catalog-diff-appsAdded')).toHaveCount(1)
  await expect(current.getByTestId('catalog-diff-featuresAdded')).toHaveCount(1)
  await expect(current.getByTestId('catalog-diff-limitsChanged')).toHaveCount(1)
  await expect(previous.getByTestId('catalog-diff-appsAdded')).toHaveCount(0)
  await expect(previous.getByTestId('catalog-diff-limitsChanged')).toHaveCount(1)
  // Nothing older to compare the first import with.
  await expect(validated.getByTestId('catalog-diff-first')).toHaveCount(1)
  await page.setViewportSize({ width: 390, height: 844 }); await open(page, '/catalog/releases')
  await expect(mobileRows(page)).toHaveCount(3); await expect(page.locator('table')).toBeHidden(); expect(await fitsWidth(page)).toBe(true)
})

test('a validated version publishes with a reason and then points on to the bundles', async ({ page }) => {
  await open(page, `/catalog/releases/${VALIDATED}`); await expectNoSecondH1(page)
  await expect(page.locator('[data-template="record"]')).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('2026.09')
  await expect(page.getByTestId('catalog-app')).toHaveCount(2)
  await expect(page.getByTestId('catalog-sellable')).toHaveCount(1)
  // Nothing older to compare this import with.
  await expect(page.getByTestId('catalog-first-import')).toBeVisible()
  const submit = page.getByTestId('catalog-action-submit'); const reason = page.getByTestId('catalog-action-reason')
  const badge = page.locator('[data-slot="lifecycle-badge"]')
  await expect(badge).toHaveText('جاهزة للاعتماد'); await expect(submit).toHaveText('اعتماد ونشر')
  await submit.click(); await expect(page.getByText('اكتب سببًا من 3 أحرف على الأقل.')).toBeVisible()
  await reason.fill('ok'); await submit.click(); await expect(page.getByText('اكتب سببًا من 3 أحرف على الأقل.')).toBeVisible()
  await expect(badge).toHaveText('جاهزة للاعتماد')
  await reason.fill('Approved for sale'); await submit.click()
  await expect(badge).toHaveText('منشورة ومتاحة'); await expect(page.getByTestId('catalog-action')).toHaveCount(0)
  await page.getByTestId('catalog-next-step').getByRole('link').click()
  await expect(page).toHaveURL(/\/bundles\/new$/)
})

test('a published version has no step; the change it carries is compared with the import before it', async ({ page }) => {
  await open(page, `/catalog/releases/${CURRENT}`); await expectNoSecondH1(page)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('2026.12')
  await expect(page.getByTestId('catalog-action')).toHaveCount(0)
  await expect(page.getByTestId('catalog-next-step')).toBeVisible()
  // HR is the application this version adds, and Projects is the one whose limit it raises.
  await expect(page.locator('[data-testid="catalog-diff-app"][data-app="hr"]')).toHaveCount(1)
  await expect(page.locator('[data-testid="catalog-diff-app"][data-app="pmo"]')).toHaveCount(1)
  // A published version builds its bundle release once; 2026.10 has one, so only 2026.12 is offered the form.
  await expect(page.getByTestId('catalog-release-form')).toBeVisible()
  await open(page, `/catalog/releases/${PUBLISHED}`)
  await expect(page.getByTestId('catalog-action')).toHaveCount(0)
  await expect(page.getByTestId('catalog-release')).toHaveCount(0)
})

test('the application record names its features, what sells it and where it is used, and links its history to the versions', async ({ page }) => {
  await open(page, '/catalog/apps/hr'); await expectNoSecondH1(page)
  await expect(page.locator('[data-template="record"]')).toHaveCount(1)
  await expect(page.getByTestId('catalog-app-description')).toBeVisible()
  await expect(page.getByTestId('catalog-app-feature')).toHaveCount(1)
  await expect(page.locator('[data-fact="features"]')).toContainText('1')
  // One bundle selects this application and one plan offers that bundle.
  await expect(page.locator('[data-fact="bundles"]')).toContainText('1')
  await expect(page.locator('[data-fact="plans"]')).toContainText('1')
  await expect(page.getByTestId('catalog-app-bundle-link')).toHaveAttribute('href', /\/bundles\/00000000-0000-4000-8000-000000000021\?returnTo=/)
  await expect(page.getByTestId('catalog-app-plan-link')).toHaveAttribute('href', /\/plans\/00000000-0000-4000-8000-000000000010\?returnTo=/)
  // Its history is every version, newest first, and the oldest import has nothing to compare with.
  const history = page.getByTestId('catalog-app-history-item')
  await expect(history).toHaveCount(3)
  await expect(history.first().getByTestId('catalog-app-history-link')).toHaveText('2026.12')
  await expect(history.last().getByTestId('catalog-app-history-first')).toBeVisible()
  await history.first().getByTestId('catalog-app-history-link').click()
  await expect(page).toHaveURL(new RegExp(`/catalog/releases/${CURRENT}$`))
})

test('an application the current version does not carry shows the not-found state', async ({ page }) => {
  await open(page, '/catalog/apps/archive')
  await expect(page.locator('[data-slot="not-found-state"]')).toBeVisible()
  await expect(page.getByTestId('catalog-app-features')).toHaveCount(0)
})

test('a version the console does not hold shows the not-found state', async ({ page }) => {
  await open(page, '/catalog/releases/00000000-0000-4000-8000-0000000004ff')
  await expect(page.locator('[data-slot="not-found-state"]')).toBeVisible()
  await expect(page.getByTestId('catalog-action')).toHaveCount(0)
})

test('a read-only account sees the versions but no form to publish one', async ({ page }) => {
  await login(page, RESTRICTED_EMAIL)
  await open(page, `/catalog/releases/${VALIDATED}`)
  await expect(page.getByTestId('catalog-action-blocked')).toBeVisible()
  await expect(page.getByTestId('catalog-action-form')).toHaveCount(0)
})
