import { expect, test } from '@playwright/test'
import { HrShiftSettingsSchema } from '@liwan/contracts'
import { collectBrowserErrors, currentRoute, dialog, heading, MOCK_STACK_ONLY, openPage as open, row, trackRefusedRequests } from './support/mock-pages'
import { login } from './support/tasmim6'

test.skip(process.env.E2E_PROJECT_POPUPS !== '1', MOCK_STACK_ONLY)

// The payroll run pages, the payslip page and the payroll settings against the stateful rows of
// hr-payroll-ui-preview-data.mjs. Run 1 is approved (2026-10), run 2 computed (2026-11), run 3 a draft (2026-12). The mock
// has the finance bridge unless a spec resets it with {finance: false}.
let errors: string[]

test.beforeEach(async ({ page }) => {
  await login(page)
  expect((await page.request.post('/api/v1/__mock/reset-payroll', { data: {} })).status()).toBe(200)
  errors = collectBrowserErrors(page)
})

test.afterEach(() => {
  expect(errors, 'no page error and no console error').toEqual([])
})

test.describe('payroll runs list', () => {
  test('lists the runs with their states and keeps the state filter on the way back', async ({ page }) => {
    await open(page, '/hr/payroll', 'الرواتب')
    await expect(row(page, /ديسمبر 2026.*مسودة/)).toBeVisible()
    await expect(row(page, /نوفمبر 2026.*محسوب/)).toBeVisible()
    await expect(row(page, /أكتوبر 2026.*معتمد/)).toBeVisible()
    await page.goto('/hr/payroll?state=approved')
    await expect(page.getByTestId('hr-payroll-count')).toHaveText('عرض 1 من 1')
    await row(page, /أكتوبر 2026/).getByRole('link', { name: /أكتوبر 2026/ }).click()
    await expect(page).toHaveURL(/\/hr\/payroll\/1\?returnTo=/)
    await page.getByRole('link', { name: 'رجوع' }).first().click()
    // The return is a client-side navigation: the route settles a moment after the click.
    await expect.poll(() => currentRoute(page)).toBe('/hr/payroll?state=approved')
  })

  test('the create panel refuses a month that has a run and opens the new run', async ({ page }) => {
    await open(page, '/hr/payroll', 'الرواتب')
    await page.getByTestId('hr-payroll-new').click()
    await expect(page).toHaveURL(/\/hr\/payroll\/new$/)
    await expect(dialog(page).getByRole('heading', { name: 'مسير رواتب جديد', exact: true })).toBeVisible()
    await expect(page.getByTestId('hr-payroll-run-submit')).toBeEnabled()
    await page.getByTestId('hr-payroll-month').fill('2026-11')
    // The refused request is logged by the browser; it is the behaviour under test.
    const withoutRefusals = trackRefusedRequests(page, '/api/v1/hr/payroll/runs')
    await page.getByTestId('hr-payroll-run-submit').click()
    await expect(dialog(page).getByText('إنشاء مسير شهر نوفمبر 2026؟')).toBeVisible()
    await page.getByTestId('inline-confirm-action').click()
    await expect(dialog(page).getByText('يوجد مسير لهذا الشهر بالفعل.')).toBeVisible()
    errors = withoutRefusals(errors)
    await page.getByTestId('hr-payroll-month').fill('2027-01')
    await page.getByTestId('hr-payroll-run-submit').click()
    await page.getByTestId('inline-confirm-action').click()
    await expect(page).toHaveURL(/\/hr\/payroll\/4\?returnTo=/)
    await expect(page.getByTestId('hr-payroll-run-state')).toHaveText('مسودة')
  })
})

test.describe('payroll run page', () => {
  test('run page shows totals and inline-confirmed approve', async ({ page }) => {
    await open(page, '/hr/payroll/2', 'مسير رواتب نوفمبر 2026')
    await expect(page.getByTestId('hr-payroll-run-state')).toHaveText('محسوب')
    await expect(page.getByTestId('hr-payroll-totals')).toContainText('صافي الرواتب')
    await expect(row(page, /ليلى الحربي/)).toBeVisible()
    // Before the approval the IBAN can still be completed in the compensation.
    await expect(page.getByTestId('hr-payroll-warnings')).toContainText('خالد الشمري: لا آيبان مسجّل، ويلزم آيبان لكل صافٍ موجب. أكمل الآيبان في التعويضات قبل الاعتماد.')
    const net = await page.getByTestId('hr-payroll-totals').innerText()

    // An input is edited in place with Arabic digits; the server's row and totals replace the cached ones.
    const bonus = page.getByTestId('hr-payroll-input-22-bonus_amount')
    await expect(bonus).toBeEnabled()
    await bonus.fill('٢٥٠٫٥')
    await bonus.press('Enter')
    await expect(bonus).toHaveValue('250.5')
    await expect(page.getByTestId('hr-payroll-totals')).not.toHaveText(net)

    // Approving asks first, inline; cancelling the confirmation changes nothing.
    await page.getByTestId('hr-payroll-approve').click()
    await expect(page.getByTestId('inline-confirm')).toContainText('اعتماد هذا المسير؟')
    await page.getByTestId('inline-confirm-cancel').click()
    await expect(page.getByTestId('hr-payroll-run-state')).toHaveText('محسوب')

    // Owner decision D-10: a net to pay without an IBAN refuses the approval and names the employee.
    const withoutRefusals = trackRefusedRequests(page, '/api/v1/hr/payroll/runs/2/approve')
    await page.getByTestId('hr-payroll-approve').click()
    await page.getByTestId('inline-confirm-action').click()
    await expect(page.getByTestId('hr-payroll-run-failure')).toHaveText('لا آيبان مسجّل لـ 1 موظف (خالد الشمري). أكمل الآيبان في التعويضات قبل الاعتماد.')
    await expect(page.getByTestId('hr-payroll-run-state')).toHaveText('محسوب')
    errors = withoutRefusals(errors)

    // With an IBAN on every employee the same approval goes through.
    expect((await page.request.post('/api/v1/__mock/reset-payroll', { data: { ibansComplete: true } })).status()).toBe(200)
    await open(page, '/hr/payroll/2', 'مسير رواتب نوفمبر 2026')
    await page.getByTestId('hr-payroll-approve').click()
    await page.getByTestId('inline-confirm-action').click()
    await expect(page.getByTestId('hr-payroll-run-state')).toHaveText('معتمد')
    await expect(page.getByTestId('hr-payroll-approve')).toHaveCount(0)
    await expect(page.getByTestId('hr-payroll-input-22-bonus_amount')).toHaveCount(0)
    await expect(page.getByTestId('hr-payroll-approval')).toContainText('Admin')
  })

  test('cancelling a draft run needs the inline confirmation and returns to the list', async ({ page }) => {
    await open(page, '/hr/payroll/3', 'مسير رواتب ديسمبر 2026')
    await expect(page.getByTestId('hr-payroll-compute')).toBeEnabled()
    await page.getByTestId('hr-payroll-cancel').click()
    await page.getByTestId('inline-confirm-action').click()
    await expect(page).toHaveURL(/\/hr\/payroll$/)
    await expect(row(page, /ديسمبر 2026/)).toHaveCount(0)
  })

  test('computing a draft fills its register', async ({ page }) => {
    await open(page, '/hr/payroll/3', 'مسير رواتب ديسمبر 2026')
    await expect(page.getByText('احتسب الرواتب لتظهر قسيمة كل موظف.')).toBeVisible()
    await page.getByTestId('hr-payroll-compute').click()
    await expect(page.getByTestId('hr-payroll-run-state')).toHaveText('محسوب')
    await expect(row(page, /منى القحطاني/)).toBeVisible()
  })

  test('the register prints with its totals and without the actions', async ({ page }) => {
    await open(page, '/hr/payroll/2', 'مسير رواتب نوفمبر 2026')
    await expect(page.getByTestId('hr-payroll-register-totals')).toBeVisible()
    await page.emulateMedia({ media: 'print' })
    await expect(page.getByTestId('hr-payroll-register-totals')).toBeVisible()
    await expect(page.getByTestId('hr-payroll-run-actions')).toBeHidden()
    await expect(page.getByTestId('hr-payroll-print')).toBeHidden()
  })
})

test.describe('payroll register print', () => {
  test('a search shows a partial register with a note, and printing loads every payslip first', async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => { (window as unknown as { printedRows: number }).printedRows = document.querySelectorAll('tbody tr').length }
    })
    await open(page, '/hr/payroll/2', 'مسير رواتب نوفمبر 2026')
    await page.getByTestId('hr-payroll-search').fill('ليلى')
    await expect(page.getByTestId('hr-payroll-register-note')).toHaveText('عرض 1 من 3')
    await expect(page.locator('tbody tr')).toHaveCount(1)
    await page.getByTestId('hr-payroll-print').click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { printedRows?: number }).printedRows)).toBe(3)
    await expect(page.locator('tbody tr')).toHaveCount(1)
  })

  test('printing with a search that matches nothing still prints every payslip', async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => { (window as unknown as { printedRows: number }).printedRows = document.querySelectorAll('tbody tr').length }
    })
    await open(page, '/hr/payroll/2', 'مسير رواتب نوفمبر 2026')
    await page.getByTestId('hr-payroll-search').fill('لا يوجد')
    await expect(page.locator('tbody tr')).toHaveCount(0)
    await page.getByTestId('hr-payroll-print').click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { printedRows?: number }).printedRows)).toBe(3)
  })
})

test.describe('payslip page', () => {
  test('payslip page prints net', async ({ page }) => {
    await page.goto('/hr/payroll/1/payslips/11')
    await expect(page.getByTestId('hr-payslip-print')).toBeEnabled()
    await expect(page.getByTestId('hr-payslip-document')).toContainText('شركة النماء للتقنية')
    await expect(page.getByTestId('hr-payslip-net')).toContainText('9,476.25')
    await expect(page.getByTestId('hr-payslip-line-GOSI_EMP')).toBeVisible()
    await page.emulateMedia({ media: 'print' })
    await expect(page.getByTestId('hr-payslip-net')).toBeVisible()
    await expect(page.getByTestId('hr-payslip-print')).toBeHidden()
    await expect(page.locator('.liwan-shell-header')).toBeHidden()
  })

  test('an unknown payslip shows the not-found state', async ({ page }) => {
    await page.goto('/hr/payroll/1/payslips/999')
    await expect(page.getByText('هذا السجل غير متاح أو لم يعد موجودًا.')).toBeVisible()
  })
})

test.describe('my payslips', () => {
  test('lists the own approved payslips and opens one as a document', async ({ page }) => {
    await open(page, '/account/pay', 'راتبي وقسائم الرواتب')
    await expect(row(page, /أكتوبر 2026/)).toBeVisible()
    await expect(row(page, /نوفمبر 2026/)).toHaveCount(0)
    await expect(page.getByRole('link', { name: /أكتوبر 2026/ })).toBeVisible()
    await page.getByRole('link', { name: /أكتوبر 2026/ }).click()
    await expect(page).toHaveURL(/\/account\/pay\/\d+\?returnTo=/)
    await expect(page.getByTestId('hr-payslip-document')).toContainText('شركة النماء للتقنية')
    await page.getByTestId('hr-my-payslip-back').click()
    // The return is a client-side navigation: the route settles a moment after the click.
    await expect.poll(() => currentRoute(page)).toBe('/account/pay')
  })

  test('an unknown own payslip shows the not-found state', async ({ page }) => {
    await page.goto('/account/pay/999')
    await expect(page.getByText('هذا السجل غير متاح أو لم يعد موجودًا.')).toBeVisible()
  })
})

test.describe('payroll posting and payment', () => {
  test('post shows unmapped-department warning then confirms inline', async ({ page }) => {
    await open(page, '/hr/payroll/1', 'مسير رواتب أكتوبر 2026')
    await expect(page.getByTestId('hr-payroll-post')).toBeEnabled()
    await expect(page.getByTestId('hr-payroll-record-payment')).toHaveCount(0)
    await page.getByTestId('hr-payroll-post').click()
    await expect(page.getByTestId('hr-payroll-posting-preview')).toBeVisible()
    await expect(page.getByTestId('hr-payroll-posting-warnings')).toContainText('خالد الشمري')
    await expect(page.getByTestId('hr-payroll-posting-totals')).toContainText('مدين')
    // Cancelling the confirmation posts nothing.
    await page.getByTestId('inline-confirm-cancel').click()
    await expect(page.getByTestId('hr-payroll-run-state')).toHaveText('معتمد')
    await page.getByTestId('hr-payroll-post').click()
    await page.getByTestId('inline-confirm-action').click()
    await expect(page.getByTestId('hr-payroll-run-state')).toHaveText('مُرحّل')
    await expect(page.getByTestId('hr-payroll-post')).toHaveCount(0)
    await expect(page.getByTestId('hr-payroll-entry')).toContainText('JE/2026/10/0001')
    await expect(page.getByTestId('hr-payroll-record-payment')).toBeEnabled()
  })

  test('a posted run records its payment from a bank journal', async ({ page }) => {
    await open(page, '/hr/payroll/1', 'مسير رواتب أكتوبر 2026')
    await page.getByTestId('hr-payroll-post').click()
    await page.getByTestId('inline-confirm-action').click()
    await expect(page.getByTestId('hr-payroll-run-state')).toHaveText('مُرحّل')
    await page.getByTestId('hr-payroll-record-payment').click()
    await expect(page.getByTestId('hr-payroll-payment-form')).toBeVisible()
    await expect(page.getByTestId('inline-confirm-action')).toBeDisabled()
    await page.getByTestId('hr-payroll-payment-journal').click()
    await page.getByRole('option', { name: /البنك/ }).first().click()
    await expect(page.getByTestId('inline-confirm-action')).toBeEnabled()
    // The default date (today) is after the run month, so the mock accepts it.
    await page.getByTestId('inline-confirm-action').click()
    await expect(page.getByTestId('hr-payroll-run-state')).toHaveText('مدفوع')
    await expect(page.getByTestId('hr-payroll-payment')).toContainText('PAY/2026/10/0001')
    await expect(page.getByTestId('hr-payroll-record-payment')).toHaveCount(0)
  })

  test('a refused posting preview shows its own text and blocks the post', async ({ page }) => {
    expect((await page.request.post('/api/v1/__mock/reset-payroll', { data: { previewError: true } })).status()).toBe(200)
    await open(page, '/hr/payroll/1', 'مسير رواتب أكتوبر 2026')
    // The refused request is logged by the browser; it is the behaviour under test.
    const withoutRefusals = trackRefusedRequests(page, '/api/v1/hr/payroll/runs/1/posting-preview')
    await page.getByTestId('hr-payroll-post').click()
    await expect(page.getByTestId('hr-payroll-preview-failure')).toContainText('بلا مركز تكلفة')
    await expect(page.getByTestId('inline-confirm-action')).toBeDisabled()
    errors = withoutRefusals(errors)
    await expect(page.getByTestId('hr-payroll-preview-retry')).toBeVisible()
  })

  test('the runs list filters posted runs', async ({ page }) => {
    await open(page, '/hr/payroll', 'الرواتب')
    await page.getByTestId('hr-payroll-state').click()
    await expect(page.getByRole('option', { name: 'مُرحّل' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'مدفوع' })).toBeVisible()
  })

  test('without the bridge the run offers no post', async ({ page }) => {
    expect((await page.request.post('/api/v1/__mock/reset-payroll', { data: { finance: false } })).status()).toBe(200)
    await open(page, '/hr/payroll/1', 'مسير رواتب أكتوبر 2026')
    await expect(page.getByTestId('hr-payroll-run-state')).toHaveText('معتمد')
    await expect(page.getByTestId('hr-payroll-post')).toHaveCount(0)
  })
})

test.describe('payroll finance settings', () => {
  test('shows the accounting mapping and saves the entry detail and a department cost center', async ({ page }) => {
    // The shared HR settings page also loads its shifts card under the existing mock entitlements.
    const shiftSettings = await page.request.get('/api/v1/hr/shifts/settings')
    expect(shiftSettings.status(), 'the shifts settings request on the payroll settings page').toBe(200)
    expect(HrShiftSettingsSchema.parse(await shiftSettings.json())).toMatchObject({
      day_reference: 'company', company_timezone: 'Asia/Riyadh', effective_timezone: 'Asia/Riyadh', revision: 0,
    })
    await open(page, '/settings/apps/hr', 'الموارد البشرية')
    await expect(page.getByTestId('hr-payroll-finance-form')).toBeVisible()
    await expect(page.getByTestId('hr-payroll-finance-submit')).toBeDisabled()
    await page.getByTestId('hr-payroll-finance-detail').click()
    await page.getByRole('option', { name: /لكل موظف/ }).click()
    await expect(page.getByTestId('hr-payroll-finance-submit')).toBeEnabled()
    await page.getByTestId('hr-payroll-finance-submit').click()
    await expect(page.getByTestId('hr-payroll-finance-submit')).toBeDisabled()
    await page.getByTestId('hr-payroll-cost-center-2').click()
    await page.getByRole('option', { name: /BR-JED/ }).click()
    await page.reload()
    await expect(page.getByTestId('hr-payroll-cost-center-2')).toContainText('فرع جدة')
    await expect(page.getByTestId('hr-payroll-finance-detail')).toContainText('لكل موظف')
  })

  test('settings hides finance section on 404', async ({ page }) => {
    expect((await page.request.post('/api/v1/__mock/reset-payroll', { data: { finance: false } })).status()).toBe(200)
    // The refused finance request is logged by the browser; it is the behaviour under test.
    const withoutFinanceRefusals = trackRefusedRequests(page, '/api/v1/hr/payroll/finance-settings')
    await open(page, '/settings/apps/hr', 'الموارد البشرية')
    await expect(page.getByTestId('hr-payroll-settings-form')).toBeVisible()
    errors = withoutFinanceRefusals(errors)
    await expect(page.getByTestId('hr-payroll-finance-form')).toHaveCount(0)
    await expect(page.getByTestId('hr-payroll-cost-center-2')).toHaveCount(0)
  })
})

test.describe('payroll settings', () => {
  test('saves a changed day divisor', async ({ page }) => {
    await open(page, '/settings/apps/hr', 'الموارد البشرية')
    await expect(page.getByTestId('hr-payroll-settings-submit')).toBeDisabled()
    await page.getByTestId('hr-payroll-divisor').click()
    await page.getByRole('option', { name: '31' }).click()
    await expect(page.getByTestId('hr-payroll-settings-submit')).toBeEnabled()
    await page.getByTestId('hr-payroll-settings-submit').click()
    await expect(page.getByTestId('hr-payroll-settings-submit')).toBeDisabled()
    await page.reload()
    await expect(page.getByTestId('hr-payroll-divisor')).toContainText('31')
  })

  test('a save after another administrator changed the settings keeps the draft and offers a reload', async ({ page }) => {
    await open(page, '/settings/apps/hr', 'الموارد البشرية')
    await page.getByTestId('hr-payroll-divisor').click()
    await page.getByRole('option', { name: '28' }).click()
    // Another administrator saves first, from the revision this page also read.
    expect((await page.request.patch('/api/v1/hr/payroll/settings', { data: { day_divisor: 31, revision: 1 } })).status()).toBe(200)
    // The refused request is logged by the browser; it is the behaviour under test.
    const withoutRefusals = trackRefusedRequests(page, '/api/v1/hr/payroll/settings')
    await page.getByTestId('hr-payroll-settings-submit').click()
    await expect(page.getByText('غيّر مستخدم آخر هذه الإعدادات أثناء تعديلك')).toBeVisible()
    errors = withoutRefusals(errors)
    await expect(page.getByTestId('hr-payroll-divisor')).toContainText('28')
    await expect(page.getByTestId('hr-payroll-settings-submit')).toBeDisabled()
    // A reload that fails keeps the editors: the draft, the conflict and the reload error stay for another attempt.
    const refuseReload = trackRefusedRequests(page, '/api/v1/hr/payroll/settings')
    await page.route('**/api/v1/hr/payroll/settings', route => route.request().method() === 'GET'
      ? route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 'invalid', message: 'unavailable' }) })
      : route.fallback())
    await page.getByTestId('hr-payroll-settings-reload').click()
    await expect(page.getByText('تعذّرت إعادة تحميل أحدث قيمة')).toBeVisible()
    await expect(page.getByTestId('hr-payroll-divisor')).toContainText('28')
    errors = refuseReload(errors)
    await page.unroute('**/api/v1/hr/payroll/settings')
    await page.getByTestId('hr-payroll-settings-reload').click()
    await expect(page.getByTestId('hr-payroll-divisor')).toContainText('31')
  })

  test('a GOSI rate form refuses a missing start date and a company rate is deleted after an inline confirmation', async ({ page }) => {
    await open(page, '/settings/apps/hr', 'الموارد البشرية')
    await expect(row(page, /المعاشات.*مشتركة/)).toBeVisible()
    await expect(page.getByTestId('hr-gosi-submit')).toHaveCount(0)
    await page.getByTestId('hr-gosi-add').click()
    await page.getByTestId('hr-gosi-employee-rate').fill('١٫٢٥')
    await page.getByTestId('hr-gosi-employer-rate').fill('2')
    await page.getByTestId('hr-gosi-wage-min').fill('0')
    await page.getByTestId('hr-gosi-wage-max').fill('45000')
    await page.getByTestId('hr-gosi-submit').click()
    await expect(page.getByText('أدخل قيمة صحيحة صفرًا أو أكثر.')).toBeVisible()

    await row(page, /الأخطار المهنية/).getByRole('button').click()
    await page.getByRole('menuitem', { name: 'حذف النسبة' }).click()
    await expect(page.getByTestId('inline-confirm')).toContainText('حذف نسبة')
    await page.getByTestId('inline-confirm-action').click()
    await expect(row(page, /الأخطار المهنية/)).toHaveCount(0)
    await expect(row(page, /المعاشات.*مشتركة/)).toBeVisible()
  })
})

test.describe('payroll salary files', () => {
  test('an approved run with an empty payment snapshot names the employee and does not send them to the compensation', async ({ page }) => {
    // Run 1 is approved while Khalid has no IBAN: its approval snapshot is empty, as only the 19.0.1.12.0 migration leaves it.
    await open(page, '/hr/payroll/1', 'مسير رواتب أكتوبر 2026')
    const warnings = page.getByTestId('hr-payroll-warnings')
    await expect(warnings).toContainText('خالد الشمري: لقطة بيانات الدفع عند اعتماد هذا المسيّر ناقصة')
    await expect(warnings).not.toContainText('قبل الاعتماد')
    // The refused request is logged by the browser; it is the behaviour under test.
    const withoutRefusals = trackRefusedRequests(page, '/api/v1/hr/payroll/runs/1/bank-file')
    await page.getByTestId('hr-payroll-download-bank').click()
    const failure = page.getByTestId('hr-payroll-run-failure')
    await expect(failure).toHaveText('تعذّر إنشاء الملف لأن لقطة بيانات الدفع عند اعتماد هذا المسيّر ناقصة لـخالد الشمري. تعديل الآيبان في التعويضات الآن لن يغيّر هذا المسيّر. تواصل مع مسؤول الرواتب أو الدعم لمعالجة موثّقة.')
    errors = withoutRefusals(errors)
  })

  test('a complete run downloads the bank file with the server file name', async ({ page }) => {
    expect((await page.request.post('/api/v1/__mock/reset-payroll', { data: { ibansComplete: true } })).status()).toBe(200)
    await open(page, '/hr/payroll/1', 'مسير رواتب أكتوبر 2026')
    const download = page.waitForEvent('download')
    await page.getByTestId('hr-payroll-download-bank').click()
    expect((await download).suggestedFilename()).toBe('salaries-2026-10.csv')
    await expect(page.getByTestId('hr-payroll-run-failure')).toHaveCount(0)
  })

  test('a read-only tenant gets disabled file buttons with an inline explanation and fires no request', async ({ page }) => {
    await page.context().addCookies([{ name: 'mock_readonly', value: 'payroll', url: process.env.E2E_BASE_URL ?? 'http://localhost:3000' }])
    const files: string[] = []
    page.on('request', request => { if (/\/(bank|wps)-file$/.test(request.url())) files.push(request.method()) })
    await open(page, '/hr/payroll/1', 'مسير رواتب أكتوبر 2026')
    await expect(page.getByTestId('hr-payroll-files-read-only')).toContainText('وضع القراءة فقط')
    await expect(page.getByTestId('hr-payroll-download-bank')).toBeDisabled()
    await expect(page.getByTestId('hr-payroll-download-wps')).toBeDisabled()
    expect(files).toEqual([])
  })

  test('a /me without the platform policy fails closed: file buttons disabled and no request', async ({ page }) => {
    await page.context().addCookies([{ name: 'mock_readonly', value: 'no-policy', url: process.env.E2E_BASE_URL ?? 'http://localhost:3000' }])
    const files: string[] = []
    page.on('request', request => { if (/\/(bank|wps)-file$/.test(request.url())) files.push(request.method()) })
    await open(page, '/hr/payroll/1', 'مسير رواتب أكتوبر 2026')
    await expect(page.getByTestId('hr-payroll-download-bank')).toBeDisabled()
    await expect(page.getByTestId('hr-payroll-download-wps')).toBeDisabled()
    expect(files).toEqual([])
  })

  test('a writable tenant sends the bank file as a POST and shows no read-only note', async ({ page }) => {
    expect((await page.request.post('/api/v1/__mock/reset-payroll', { data: { ibansComplete: true } })).status()).toBe(200)
    const methods: string[] = []
    page.on('request', request => { if (/\/bank-file$/.test(request.url())) methods.push(request.method()) })
    await open(page, '/hr/payroll/1', 'مسير رواتب أكتوبر 2026')
    await expect(page.getByTestId('hr-payroll-files-read-only')).toHaveCount(0)
    const download = page.waitForEvent('download')
    await page.getByTestId('hr-payroll-download-bank').click()
    await download
    expect(methods).toEqual(['POST'])
  })

  test('a computed run offers no salary files', async ({ page }) => {
    await open(page, '/hr/payroll/2', 'مسير رواتب نوفمبر 2026')
    await expect(page.getByTestId('hr-payroll-totals')).toBeVisible()
    await expect(page.getByTestId('hr-payroll-files')).toHaveCount(0)
  })

  test('the GOSI statement opens from the run and lists the branches and totals', async ({ page }) => {
    await open(page, '/hr/payroll/1', 'مسير رواتب أكتوبر 2026')
    await page.getByTestId('hr-payroll-open-gosi').click()
    await expect(heading(page, 'كشف التأمينات الاجتماعية أكتوبر 2026')).toBeVisible()
    await expect(row(page, /ليلى الحربي/)).toBeVisible()
    await expect(page.getByTestId('hr-payroll-gosi-totals')).toContainText('حصة صاحب العمل')
  })

  test('the GOSI statement of a computed run is refused', async ({ page }) => {
    // The refused request is logged by the browser; it is the behaviour under test.
    const withoutRefusals = trackRefusedRequests(page, '/api/v1/hr/payroll/runs/2/gosi-statement')
    await page.goto('/hr/payroll/2/gosi')
    await expect(page.getByTestId('hr-payroll-gosi-not-approved')).toContainText('كشف التأمينات متاح بعد اعتماد المسيّر')
    await page.getByTestId('hr-payroll-gosi-back').click()
    await expect(page).toHaveURL(/\/hr\/payroll\/2/)
    errors = withoutRefusals(errors)
  })

  test('a company bank profile is added with a constant column, a shared one is read-only', async ({ page }) => {
    await open(page, '/settings/apps/hr', 'الموارد البشرية')
    await expect(row(page, /ملف بنكي عام.*مشترك/)).toBeVisible()
    await page.getByTestId('hr-bank-profile-add').click()
    await page.getByTestId('hr-bank-profile-name').fill('تحويل الراجحي')
    await page.getByTestId('hr-bank-profile-label-0').fill('IBAN')
    await page.getByTestId('hr-bank-profile-add-column').click()
    await page.getByTestId('hr-bank-profile-source-1').click()
    await page.getByRole('option', { name: 'قيمة ثابتة' }).click()
    await page.getByTestId('hr-bank-profile-label-1').fill('Type')
    await page.getByTestId('hr-bank-profile-constant-1').fill('SAL')
    await page.getByTestId('hr-bank-profile-submit').click()
    await expect(row(page, /تحويل الراجحي/)).toBeVisible()
    await expect(page.getByTestId('hr-bank-profile-form')).toHaveCount(0)
  })
})

// The settlement section of the offboarding record (leavers of the offboarding preview: 2 resigned, 3 is the signed-in
// employee with no mapped reason). The first read of a settlement that does not exist yet is a 404, and a missing case or
// a refused confirmation is a 422 or 403: the browser logs those requests, they are the behaviour under test.
// Only refused requests to the end-of-service routes are expected, and one console error per refused response is dropped.

test.describe('end of service', () => {
  let withoutEosRefusals: (messages: string[]) => string[]
  test.beforeEach(({ page }) => { withoutEosRefusals = trackRefusedRequests(page, '/api/v1/hr/payroll/eos/') })

  test('offboarding record shows the settlement only with payroll read', async ({ page }) => {
    await open(page, '/hr/offboarding/2', 'خالد الشمري')
    await expect(page.getByTestId('hr-eos-section')).toBeVisible()
    await expect(page.getByTestId('hr-eos-figures')).toContainText('سنوات الخدمة')
    await page.context().addCookies([{ name: 'mock_caps', value: 'no_payroll', url: new URL(page.url()).origin }])
    await page.reload()
    await expect(heading(page, 'خالد الشمري')).toBeVisible()
    await expect(page.getByTestId('hr-eos-section')).toHaveCount(0)
    errors = withoutEosRefusals(errors)
  })

  test('a settlement is saved with Arabic-digit deductions and confirmed inline', async ({ page }) => {
    await open(page, '/hr/offboarding/2', 'خالد الشمري')
    await expect(page.getByTestId('hr-eos-case')).toContainText('استقالة')
    await page.getByTestId('hr-eos-deductions').fill('٣٠٠')
    await page.getByTestId('hr-eos-save').click()
    await expect(page.getByTestId('hr-eos-state')).toHaveText('مسودة')
    await expect(page.getByTestId('hr-eos-total')).toContainText('9,307.50')
    // Editing the saved draft marks its figures as stale until it is saved again.
    await expect(page.getByTestId('hr-eos-stale')).toHaveCount(0)
    await page.getByTestId('hr-eos-deductions').fill('٤٠٠')
    await expect(page.getByTestId('hr-eos-stale')).toBeVisible()
    await page.getByTestId('hr-eos-deductions').fill('300')
    await expect(page.getByTestId('hr-eos-stale')).toHaveCount(0)
    // Confirming asks first, inline; cancelling changes nothing.
    await page.getByTestId('hr-eos-confirm').click()
    await expect(page.getByTestId('inline-confirm')).toContainText('اعتماد تسوية نهاية الخدمة؟')
    await page.getByTestId('inline-confirm-cancel').click()
    await expect(page.getByTestId('hr-eos-state')).toHaveText('مسودة')
    await page.getByTestId('hr-eos-confirm').click()
    await page.getByTestId('inline-confirm-action').click()
    await expect(page.getByTestId('hr-eos-state')).toHaveText('معتمدة')
    await expect(page.getByTestId('hr-eos-save')).toHaveCount(0)
    errors = withoutEosRefusals(errors)
  })

  test('a reason without a case asks for one, and the own settlement cannot be confirmed', async ({ page }) => {
    await open(page, '/hr/offboarding/3', 'منى القحطاني')
    await expect(page.getByTestId('hr-eos-failure')).toContainText('سبب المغادرة غير مربوط بحالة مكافأة')
    await page.getByTestId('hr-eos-case').click()
    await page.getByRole('option', { name: 'إنهاء من صاحب العمل' }).click()
    await expect(page.getByTestId('hr-eos-figures')).toContainText('مكافأة نهاية الخدمة')
    await page.getByTestId('hr-eos-save').click()
    await expect(page.getByTestId('hr-eos-state')).toHaveText('مسودة')
    await page.getByTestId('hr-eos-confirm').click()
    await page.getByTestId('inline-confirm-action').click()
    await expect(page.getByTestId('hr-eos-failure')).toContainText('لا يمكنك اعتماد تسوية نهاية خدمتك')
    await expect(page.getByTestId('hr-eos-state')).toHaveText('مسودة')
    errors = withoutEosRefusals(errors)
  })

  test('the settings map a departure reason to a case', async ({ page }) => {
    await open(page, '/settings/apps/hr', 'الموارد البشرية')
    await expect(page.getByTestId('hr-eos-case-2')).toContainText('غير مربوط')
    await page.getByTestId('hr-eos-case-2').click()
    await page.getByRole('option', { name: 'انتهاء العقد' }).click()
    await page.reload()
    await expect(page.getByTestId('hr-eos-case-2')).toContainText('انتهاء العقد')
  })

  test('an approved run posts the end-of-service provision once, after an inline confirmation', async ({ page }) => {
    await open(page, '/hr/payroll/1', 'مسير رواتب أكتوبر 2026')
    await page.getByTestId('hr-payroll-eos-provision').click()
    await expect(page.getByTestId('inline-confirm')).toContainText('تكوين مخصص نهاية الخدمة لهذا الشهر؟')
    await page.getByTestId('inline-confirm-cancel').click()
    await expect(page.getByTestId('hr-payroll-eos-provision-entry')).toHaveCount(0)
    await page.getByTestId('hr-payroll-eos-provision').click()
    await page.getByTestId('inline-confirm-action').click()
    await expect(page.getByTestId('hr-payroll-eos-provision')).toHaveCount(0)
    await expect(page.getByTestId('hr-payroll-eos-provision-entry')).toContainText('JE/2026/10/EOS')
  })
})

test.describe('payroll pages for a reader', () => {
  test('a reader without the manage capability gets no create button', async ({ page }) => {
    await page.goto('/login')
    await page.context().addCookies([{ name: 'mock_caps', value: 'reader', url: new URL(page.url()).origin }])
    await page.goto('/hr/payroll')
    await expect(heading(page, 'الرواتب')).toBeVisible()
    await expect(row(page, /نوفمبر 2026/)).toBeVisible()
    await expect(page.getByTestId('hr-payroll-new')).toHaveCount(0)
  })
})
