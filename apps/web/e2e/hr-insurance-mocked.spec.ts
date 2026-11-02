import { expect, test } from '@playwright/test'
import { collectBrowserErrors, currentRoute, dialog, heading, MOCK_STACK_ONLY, openPage as open, row } from './support/mock-pages'
import { login } from './support/tasmim6'

test.skip(process.env.E2E_PROJECT_POPUPS !== '1', MOCK_STACK_ONLY)

// Medical insurance against the synthetic rows of hr-areas-ui-preview-data.mjs (stateful; reset before each test).
let errors: string[]

test.beforeEach(async ({ page }) => {
  await login(page)
  expect((await page.request.post('/api/v1/__mock/reset-insurance', { data: {} })).status()).toBe(200)
  errors = collectBrowserErrors(page)
})

test.afterEach(() => {
  expect(errors, 'no page error and no console error').toEqual([])
})

test.describe('the insurance list', () => {
  test('shows the counts, the enrollments and switches to the plans and the providers', async ({ page }) => {
    await open(page, '/hr/insurance', 'التأمين الطبي')
    await expect(page.getByTestId('hr-insurance-kpis')).toBeVisible()
    await expect(row(page, /سارة محمد/)).toBeVisible()
    await expect(page.getByTestId('hr-insurance-count')).toBeVisible()
    await page.getByTestId('hr-insurance-section-plans').click()
    await expect(page).toHaveURL(/section=plans/)
    await expect(row(page, /الباقة الذهبية 2026/)).toBeVisible()
    await page.getByTestId('hr-insurance-section-providers').click()
    await expect(page.getByTestId('hr-insurance-providers')).toBeVisible()
    await expect(page.getByTestId('hr-insurance-provider-1')).toBeVisible()
  })

  test('filters the enrollments by state from the URL', async ({ page }) => {
    await open(page, '/hr/insurance?state=ended', 'التأمين الطبي')
    await expect(row(page, /ليلى الدوسري/)).toBeVisible()
    await expect(row(page, /سارة محمد/)).toHaveCount(0)
  })
})

test.describe('an enrollment', () => {
  test('opens its record with the masked dependents and ends one inline', async ({ page }) => {
    await open(page, '/hr/insurance', 'التأمين الطبي')
    await row(page, /سارة محمد/).click()
    await expect(page).toHaveURL(/\/hr\/insurance\/enrollments\/1/)
    await expect(page.getByTestId('hr-insurance-member-number')).toHaveText('MBR-777001')
    await expect(page.getByTestId('hr-insurance-dependent-1')).toContainText('******5432')
    await expect(page.getByTestId('hr-insurance-dependent-1')).not.toContainText('1098765432')
    await page.getByTestId('hr-insurance-dependent-end-1').click()
    await page.getByTestId('inline-confirm-action').click()
    await expect(page.getByTestId('hr-insurance-dependent-1')).toContainText('منتهي')
  })

  test('adds a dependent inline and keeps the enrollment dates', async ({ page }) => {
    await open(page, '/hr/insurance/enrollments/2', 'خالد الشمري · الباقة الذهبية 2026')
    await page.getByTestId('hr-insurance-dependent-add').click()
    await page.getByTestId('hr-insurance-dependent-name').fill('منى الشمري')
    await page.getByTestId('hr-insurance-dependent-relation').click()
    await page.getByRole('option', { name: 'زوج أو زوجة' }).click()
    await page.getByTestId('hr-insurance-dependent-submit').click()
    await expect(page.getByTestId('hr-insurance-dependents')).toContainText('منى الشمري')
  })

  test('ends the coverage after an inline confirmation and keeps the record as history', async ({ page }) => {
    await open(page, '/hr/insurance/enrollments/3', 'منى القحطاني · الباقة الفضية 2026')
    await page.getByTestId('hr-insurance-end').click()
    await expect(page.getByTestId('inline-confirm')).toBeVisible()
    await page.getByTestId('inline-confirm-action').click()
    await expect(page.getByTestId('hr-insurance-state')).toHaveText('منتهي')
    await expect(page.getByTestId('hr-insurance-end')).toHaveCount(0)
  })

  test('refuses an overlapping enrollment with the server message inside the create panel', async ({ page }) => {
    await open(page, '/hr/insurance', 'التأمين الطبي')
    await page.getByTestId('hr-insurance-new').click()
    await expect(page).toHaveURL(/\/hr\/insurance\/enrollments\/new$/)
    await expect(dialog(page).getByRole('heading', { name: 'تسجيل جديد', exact: true })).toBeVisible()
    await dialog(page).getByRole('button', { name: 'إغلاق' }).click()
    await expect(dialog(page)).toHaveCount(0)
    expect(currentRoute(page)).toBe('/hr/insurance')
    await expect(heading(page, 'التأمين الطبي')).toBeVisible()
  })
})

test.describe('plans and the settings', () => {
  test('a plan opens its record and archives inline', async ({ page }) => {
    await open(page, '/hr/insurance?section=plans', 'التأمين الطبي')
    await row(page, /الباقة الفضية 2026/).click()
    await expect(page).toHaveURL(/\/hr\/insurance\/plans\/2/)
    await page.getByTestId('hr-insurance-plan-archive').click()
    await page.getByTestId('inline-confirm-action').click()
    await expect(page.getByTestId('hr-insurance-plan-state')).toHaveText('مؤرشفة')
  })

  test('the HR settings carry the insurance policy and the providers', async ({ page }) => {
    await page.goto('/settings/apps/hr#insurance')
    await expect(page.getByTestId('hr-insurance-settings')).toBeVisible()
    await expect(page.getByTestId('hr-insurance-providers')).toBeVisible()
    await page.getByTestId('hr-insurance-alert-days').fill('90')
    await page.getByTestId('hr-insurance-alert-days').press('Tab')
    await page.getByTestId('hr-insurance-settings-save').click()
    await expect(page.getByTestId('hr-insurance-settings-save')).toBeDisabled()
  })
})

test.describe('the employee card', () => {
  test('shows the own cover with the dependents and without the HR notes', async ({ page }) => {
    await open(page, '/account/insurance', 'تأميني')
    const card = page.getByTestId('hr-own-insurance-1')
    await expect(card).toBeVisible()
    await expect(card).toContainText('الباقة الذهبية 2026')
    await expect(page.getByTestId('hr-own-insurance-dependents')).toContainText('عمر محمد')
    await expect(page.getByText('تأمين شامل للأسنان.')).toHaveCount(0)
  })

  test('hides the dependents when the company policy shows the enrollment only', async ({ page }) => {
    const response = await page.request.patch('/api/v1/hr/insurance/settings', {
      data: { insurance_visibility: 'own_enrollment_only', insurance_expiry_alert_days: 60, insurance_require_dependent_id: false, revision: 1 },
    })
    expect(response.status()).toBe(200)
    await open(page, '/account/insurance', 'تأميني')
    await expect(page.getByTestId('hr-own-insurance-1')).toBeVisible()
    await expect(page.getByTestId('hr-own-insurance-dependents')).toHaveCount(0)
  })
})
