import { expect, test, type Page } from '@playwright/test'
import { expectNoSecondH1, fitsWidth, login, navigateClient, open, RESTRICTED_EMAIL } from './commercial-helpers'

// Every moved page renders against the stub control plane for an owner: an h1, no console errors,
// no raw translation keys, no horizontal overflow.
const PLAN = '00000000-0000-4000-8000-000000000010'
const BUNDLE = '00000000-0000-4000-8000-000000000020'
const PACKAGE = '00000000-0000-4000-8000-000000000301'

const PAGES = [
  '/overview', '/customers', '/customers/cust-alpha', '/customers/cust-alpha/change', '/customers/cust-alpha/terms/new',
  '/tenants', '/tenants/new', '/tenants/tenant-1', '/operations', '/operations/op-1',
  '/plans', '/plans/new', `/plans/${PLAN}`, `/plans/${PLAN}/edit`,
  '/bundles', '/bundles/new', `/bundles/${BUNDLE}`, `/bundles/${BUNDLE}/edit`,
  '/catalog', `/catalog/${PACKAGE}`, '/invoices', '/invoices/inv-1', '/audit',
]
// Entries that only redirect: the destination is what renders.
const REDIRECTS: Record<string, string> = { '/': '/overview', '/catalog/new': '/catalog', [`/catalog/${PACKAGE}/edit`]: `/catalog/${PACKAGE}` }
const RAW_KEY = /^(vendor|commercial|adminAuth|app|states)\.[A-Za-z0-9_.]+$/

async function expectCleanPage(page: Page, path: string, errors: string[]) {
  await open(page, path)
  await expectNoSecondH1(page)
  const lines = (await page.locator('body').innerText()).split('\n').map(line => line.trim())
  expect(lines.filter(line => RAW_KEY.test(line)), `${path} shows raw keys`).toEqual([])
  expect(await fitsWidth(page), `${path} overflows`).toBe(true)
  expect(errors, `${path} logged errors`).toEqual([])
}

test.describe('vendor admin pages render', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  let errors: string[]
  test.beforeEach(async ({ page }) => {
    errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await login(page)
  })

  for (const path of PAGES) test(`${path}`, async ({ page }) => { await expectCleanPage(page, path, errors) })
  for (const [from, to] of Object.entries(REDIRECTS)) {
    test(`${from} redirects to ${to}`, async ({ page }) => {
      await page.goto(from)
      await expect.poll(() => new URL(page.url()).pathname).toBe(to)
      await expectCleanPage(page, to, errors)
    })
  }
})

test.describe('list states', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test('an empty commercial list shows no table and no raw key', async ({ page }) => {
    await open(page, '/overview')
    await page.route('**/api/vendor/v1/commercial/customers**', route => route.fulfill({ json: { items: [], total: 0 } }))
    await navigateClient(page, '/customers')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('العملاء التجاريون')
    await expect(page.locator('[data-slot="data-table"] tbody tr')).toHaveCount(0)
    expect((await page.locator('body').innerText()).split('\n').filter(line => RAW_KEY.test(line.trim()))).toEqual([])
  })

  test('an upstream failure shows the error state', async ({ page }) => {
    await open(page, '/overview')
    await page.route('**/api/vendor/v1/commercial/customers**', route => route.fulfill({ status: 503, json: { code: 'vendor_unavailable', message: 'down' } }))
    await navigateClient(page, '/customers')
    await expect(page.locator('[data-slot="error-state"]')).toBeVisible()
  })

  test('a refused list shows the forbidden state', async ({ page }) => {
    await open(page, '/overview')
    await page.route('**/api/vendor/v1/commercial/customers**', route => route.fulfill({ status: 403, json: { code: 'forbidden', message: 'no' } }))
    await navigateClient(page, '/customers')
    await expect(page.locator('[data-slot="forbidden-state"]')).toBeVisible()
  })
})

test.describe('restricted role', () => {
  test('cannot use the plan form', async ({ page }) => {
    await login(page, RESTRICTED_EMAIL)
    await page.goto('/plans/new')
    await expect(page.getByRole('textbox')).toHaveCount(0)
  })
})
