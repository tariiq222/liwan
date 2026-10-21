import { expect, test } from '@playwright/test'
import { collectBrowserErrors, currentRoute, dialog, heading, MOCK_STACK_ONLY, openPage as open, row } from './support/mock-pages'
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
    expect(currentRoute(page)).toBe('/hr/payroll?state=approved')
  })

  test('the create panel refuses a month that has a run and opens the new run', async ({ page }) => {
    await open(page, '/hr/payroll', 'الرواتب')
    await page.getByTestId('hr-payroll-new').click()
    await expect(page).toHaveURL(/\/hr\/payroll\/new$/)
    await expect(dialog(page).getByRole('heading', { name: 'مسير رواتب جديد', exact: true })).toBeVisible()
    await expect(page.getByTestId('hr-payroll-run-submit')).toBeEnabled()
    await page.getByTestId('hr-payroll-month').fill('2026-11')
    await page.getByTestId('hr-payroll-run-submit').click()
    await expect(dialog(page).getByText('يوجد مسير لهذا الشهر بالفعل.')).toBeVisible()
    // The refused request is logged by the browser; it is the behaviour under test.
    errors = errors.filter(message => !message.includes('422'))
    await page.getByTestId('hr-payroll-month').fill('2027-01')
    await page.getByTestId('hr-payroll-run-submit').click()
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
    await expect(page.getByTestId('hr-payroll-warnings')).toContainText('خالد الشمري')
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
    await expect(page.locator('.webvue-shell-header')).toBeHidden()
  })

  test('an unknown payslip shows the not-found state', async ({ page }) => {
    await page.goto('/hr/payroll/1/payslips/999')
    await expect(page.getByText('هذا السجل غير متاح أو لم يعد موجودًا.')).toBeVisible()
  })
})

test.describe('my payslips', () => {
  test('lists the own approved payslips and opens one as a document', async ({ page }) => {
    await open(page, '/hr/payroll/mine', 'قسائمي')
    await expect(row(page, /أكتوبر 2026/)).toBeVisible()
    await expect(row(page, /نوفمبر 2026/)).toHaveCount(0)
    await expect(page.getByRole('link', { name: /أكتوبر 2026/ })).toBeVisible()
    await page.getByRole('link', { name: /أكتوبر 2026/ }).click()
    await expect(page).toHaveURL(/\/hr\/payroll\/mine\/\d+\?returnTo=/)
    await expect(page.getByTestId('hr-payslip-document')).toContainText('شركة النماء للتقنية')
    await page.getByTestId('hr-my-payslip-back').click()
    expect(currentRoute(page)).toBe('/hr/payroll/mine')
  })

  test('an unknown own payslip shows the not-found state', async ({ page }) => {
    await page.goto('/hr/payroll/mine/999')
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
    await open(page, '/hr/payroll/settings', 'إعدادات الرواتب')
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
    await open(page, '/hr/payroll/settings', 'إعدادات الرواتب')
    await expect(page.getByTestId('hr-payroll-settings-form')).toBeVisible()
    // The refused finance request is logged by the browser; it is the behaviour under test.
    errors = errors.filter(message => !message.includes('404'))
    await expect(page.getByTestId('hr-payroll-finance-form')).toHaveCount(0)
    await expect(page.getByTestId('hr-payroll-cost-center-2')).toHaveCount(0)
  })
})

test.describe('payroll settings', () => {
  test('saves a changed day divisor', async ({ page }) => {
    await open(page, '/hr/payroll/settings', 'إعدادات الرواتب')
    await expect(page.getByTestId('hr-payroll-settings-submit')).toBeDisabled()
    await page.getByTestId('hr-payroll-divisor').click()
    await page.getByRole('option', { name: '31' }).click()
    await expect(page.getByTestId('hr-payroll-settings-submit')).toBeEnabled()
    await page.getByTestId('hr-payroll-settings-submit').click()
    await expect(page.getByTestId('hr-payroll-settings-submit')).toBeDisabled()
    await page.reload()
    await expect(page.getByTestId('hr-payroll-divisor')).toContainText('31')
  })

  test('a GOSI rate form refuses a missing start date and a company rate is deleted after an inline confirmation', async ({ page }) => {
    await open(page, '/hr/payroll/settings', 'إعدادات الرواتب')
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
