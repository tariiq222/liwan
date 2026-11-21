import { expect, test } from '@playwright/test'
import { expectNoSecondH1, fitsWidth, login, mobileRows, open, RESTRICTED_EMAIL, rows } from './commercial-helpers'

const DRAFT = '00000000-0000-4000-8000-000000000401'
const VALIDATED = '00000000-0000-4000-8000-000000000402'
const PUBLISHED = 'cat-1'

test.beforeEach(async ({ page }) => { await login(page) })

test('the tabs follow the build order: applications, bundles, plans, then the retired packages', async ({ page }) => {
  await open(page, '/catalog'); await expectNoSecondH1(page)
  const tabs = page.locator('[data-testid^="catalog-tab-"]')
  await expect(tabs).toHaveCount(4)
  expect(await tabs.evaluateAll(items => items.map(item => item.getAttribute('data-testid')))).toEqual(['catalog-tab-catalog', 'catalog-tab-bundles', 'catalog-tab-plans', 'catalog-tab-packages'])
  await expect(page.getByTestId('catalog-tab-catalog')).toHaveAttribute('aria-current', 'page')
  await page.getByTestId('catalog-tab-packages').click(); await expect(page).toHaveURL(/\/packages$/)
})

test('the catalog lists every imported version with its status and explains the three steps', async ({ page }) => {
  await open(page, '/catalog')
  await expect(page.locator('[data-template="list"]')).toHaveCount(1); await expect(rows(page)).toHaveCount(3)
  await expect(page.locator('[data-shortcut-create]')).toHaveCount(0)
  await expect(page.getByTestId('catalog-steps').locator('li')).toHaveCount(3)
  await expect(page.getByTestId('catalog-steps').locator('a')).toHaveCount(3)
  await expect(rows(page).first()).toContainText('2026.12')
  await page.setViewportSize({ width: 390, height: 844 }); await open(page, '/catalog')
  await expect(mobileRows(page)).toHaveCount(3); await expect(page.locator('table')).toBeHidden(); expect(await fitsWidth(page)).toBe(true)
})

test('a draft is validated and then published with a reason, and the record points to the bundles', async ({ page }) => {
  await open(page, `/catalog/${DRAFT}`); await expectNoSecondH1(page)
  await expect(page.locator('[data-template="record"]')).toHaveCount(1)
  await expect(page.getByTestId('catalog-app')).toHaveCount(3)
  await expect(page.getByTestId('catalog-sellable')).toHaveCount(2)
  const submit = page.getByTestId('catalog-action-submit'); const reason = page.getByTestId('catalog-action-reason')
  await expect(submit).toBeEnabled()
  const badge = page.locator('[data-slot="lifecycle-badge"]')
  await expect(badge).toHaveText('مسودة'); await expect(submit).toHaveText('تحقق')
  await submit.click(); await expect(page.getByText('اكتب سببًا من 3 أحرف على الأقل.')).toBeVisible()
  await reason.fill('ok'); await submit.click(); await expect(page.getByText('اكتب سببًا من 3 أحرف على الأقل.')).toBeVisible()
  await expect(badge).toHaveText('مسودة')
  await reason.fill('Source reviewed'); await submit.click()
  await expect(badge).toHaveText('جاهزة للاعتماد'); await expect(submit).toHaveText('اعتماد ونشر')
  await reason.fill('Approved for sale'); await submit.click()
  await expect(badge).toHaveText('منشورة ومتاحة'); await expect(page.getByTestId('catalog-action')).toHaveCount(0)
  await page.getByTestId('catalog-next-step').getByRole('link').click()
  await expect(page).toHaveURL(/\/bundles\/new$/)
})

test('a validated version publishes and shows as published in the list', async ({ page }) => {
  await open(page, `/catalog/${VALIDATED}`)
  await page.getByTestId('catalog-action-reason').fill('Approved for sale'); await page.getByTestId('catalog-action-submit').click()
  await expect(page.getByTestId('catalog-next-step')).toBeVisible()
  await open(page, '/catalog')
  await expect(rows(page).filter({ hasText: '2026.11' })).toContainText('منشورة ومتاحة')
})

test('a published version offers no step, only the way on to the bundles', async ({ page }) => {
  await open(page, `/catalog/${PUBLISHED}`)
  await expect(page.getByTestId('catalog-action')).toHaveCount(0); await expect(page.getByTestId('catalog-next-step')).toBeVisible()
})

test('a version that is not in the list shows the not-found state', async ({ page }) => {
  await open(page, '/catalog/00000000-0000-4000-8000-0000000004ff')
  await expect(page.getByTestId('catalog-action')).toHaveCount(0); await expect(page.getByTestId('catalog-app')).toHaveCount(0)
})

test('a read-only account sees the versions but no form to take the step', async ({ page }) => {
  await login(page, RESTRICTED_EMAIL)
  await open(page, `/catalog/${DRAFT}`)
  await expect(page.getByTestId('catalog-action-blocked')).toBeVisible(); await expect(page.getByTestId('catalog-action-form')).toHaveCount(0)
})
