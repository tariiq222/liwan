import { expect, test, type Page, type Route } from '@playwright/test'
import { PayableInvoiceSchema } from '@webvue/contracts'
import { collectBrowserErrors, heading, MOCK_STACK_ONLY, openPage as open, trackRefusedRequests } from './support/mock-pages'
import { login } from './support/tasmim6'

test.skip(process.env.E2E_PROJECT_POPUPS !== '1', MOCK_STACK_ONLY)

// The customer's pay-by-link pages and the staff "payment link" action against payments-mock-routes.mjs. The pay pages are
// public: those tests never sign in. The mock serves invoices 2 (payable), 3 (payable in part, its start is refused),
// 4 (paid), 6 (processing), 8 (not payable) and 9 (payable with no payment method), all with the access token `tok-<id>`;
// invoice 10 answers 429 (the service is busy).
const PAY = (id: number, token = `tok-${id}`) => `/pay/invoice/${id}?access_token=${token}`
const STATUS = (id: number, token = `tok-${id}`) => `/pay/invoice/${id}/status?access_token=${token}`
const GATEWAY = 'https://gateway.example/**'
const CREDENTIALS = { paymob_public_key: 'pk', paymob_secret_key: 'sk', paymob_hmac_key: 'hm', paymob_api_key: 'ak' }

let errors: string[]

test.beforeEach(({ page }) => {
  errors = collectBrowserErrors(page)
})

test.afterEach(() => {
  expect(errors, 'no page error and no console error').toEqual([])
})

const payButton = (page: Page) => page.getByTestId('pay-submit')
const option = (page: Page, name: string | RegExp) => page.getByRole('radio', { name })
// A toast's own text; the page's screen-reader live region repeats it, so a plain text locator would match twice.
const toast = (page: Page, text: string) => page.locator('[data-slot="title"], [data-slot="description"]').filter({ hasText: text })

/** Opens a pay page and waits until its button can be clicked (the page has hydrated). */
async function openPayable(page: Page, path = PAY(2)) {
  await page.goto(path)
  await expect(payButton(page)).toBeEnabled()
}

/** Stands in for the gateway's page: records what the browser sent and the return cookie it held at that moment. */
async function captureGateway(page: Page) {
  const seen: { url: string; method: string; body: string | null; cookie: string | undefined }[] = []
  await page.route(GATEWAY, async (route: Route) => {
    const request = route.request()
    const cookie = (await page.context().cookies()).find(item => item.name === 'webvue_pay_return')
    seen.push({ url: request.url(), method: request.method(), body: request.postData(), cookie: cookie ? `${cookie.value} ${cookie.path}` : undefined })
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>gateway</title><h1>gateway</h1>' })
  })
  return seen
}

test.describe('the pay page', () => {
  test('opens with no session, in Arabic RTL, under the tenant\'s own name, and lists the invoice and its payment options', async ({ page }) => {
    await page.goto(PAY(2))
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(heading(page, 'دفع الفاتورة')).toBeVisible()
    await expect(page.getByTestId('pay-brand')).toHaveText('ويب فيو')
    await expect(page.getByTestId('pay-amount-due')).toHaveText('16,905.00 SAR')
    await expect(page.getByTestId('pay-number')).toContainText('INV/2026/0002')
    await expect(page.getByTestId('pay-merchant')).toContainText('ويب فيو')
    await expect(page.getByTestId('pay-due-date')).toContainText('31 أكتوبر 2026')
    await expect(page.getByTestId('pay-total')).toHaveCount(0)
    await expect(option(page, /بطاقة بنكية/)).toBeChecked()
    await expect(option(page, /مدى/)).not.toBeChecked()
    await expect(page.getByTestId('pay-options')).toContainText('paymob')
    await expect(payButton(page)).toBeEnabled()
    await expect(page).toHaveURL(/\/pay\/invoice\/2\?access_token=tok-2$/)
    // The mock's answer is the contract the page reads.
    const answer = PayableInvoiceSchema.parse(await (await page.request.get('/api/v1/public/payments/invoices/2?access_token=tok-2')).json())
    expect(answer.status).toBe('payable')
  })

  test('shows the total beside the amount due when the invoice was paid in part', async ({ page }) => {
    await openPayable(page, PAY(3))
    await expect(page.getByTestId('pay-amount-due')).toHaveText('3,000.00 SAR')
    await expect(page.getByTestId('pay-total')).toContainText('8,000.00 SAR')
  })

  test('a get redirect: stores the return cookie first, then opens the gateway with the fields as query', async ({ page }) => {
    const seen = await captureGateway(page)
    await openPayable(page)
    await payButton(page).click()
    await expect.poll(() => seen.length).toBe(1)
    expect(seen[0]).toEqual({
      url: 'https://gateway.example/checkout?payment_token=pt_2_card&reference=INV%2F2026%2F0002',
      method: 'GET',
      body: null,
      cookie: '2.tok-2 /payment',
    })
  })

  test('a post redirect: stores the return cookie first, then submits the fields as a form', async ({ page }) => {
    const seen = await captureGateway(page)
    await openPayable(page)
    await option(page, /مدى/).click()
    await expect(option(page, /مدى/)).toBeChecked()
    await payButton(page).click()
    await expect.poll(() => seen.length).toBe(1)
    expect(seen[0]).toMatchObject({ url: 'https://gateway.example/checkout', method: 'POST', cookie: '2.tok-2 /payment' })
    expect(new URLSearchParams(seen[0]!.body ?? '').get('payment_token')).toBe('pt_2_mada')
    expect(new URLSearchParams(seen[0]!.body ?? '').get('reference')).toBe('INV/2026/0002')
  })

  test('sends only the token and the chosen option when it starts the payment', async ({ page }) => {
    await captureGateway(page)
    const bodies: unknown[] = []
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/transactions')) bodies.push(request.postDataJSON()) })
    await openPayable(page)
    await option(page, /مدى/).click()
    await payButton(page).click()
    await expect.poll(() => bodies.length).toBe(1)
    expect(bodies).toEqual([{ access_token: 'tok-2', provider_id: 7, payment_method_id: 12 }])
  })

  test('the gateway\'s return finds the cookie and lands on the invoice\'s status page', async ({ page }) => {
    await captureGateway(page)
    await openPayable(page)
    await payButton(page).click()
    await expect.poll(async () => (await page.context().cookies()).some(item => item.name === 'webvue_pay_return')).toBe(true)
    await page.goto('/payment/paymob/return?success=true')
    await expect(page).toHaveURL(/\/pay\/invoice\/2\/status\?access_token=tok-2$/)
    await expect(page.getByTestId('pay-status-confirming')).toBeVisible()
    expect((await page.context().cookies()).some(item => item.name === 'webvue_pay_return')).toBe(false)
  })

  test('a start the gateway refuses stays on the page with a clear message, nothing stored and the button usable again', async ({ page }) => {
    const seen = await captureGateway(page)
    const withoutRefusals = trackRefusedRequests(page, '/api/v1/public/payments')
    await openPayable(page, PAY(3))
    await payButton(page).click()
    await expect(page.getByTestId('pay-start-error')).toContainText('بوابة الدفع غير متاحة الآن')
    await expect(payButton(page)).toBeEnabled()
    expect(seen).toEqual([])
    expect((await page.context().cookies()).some(item => item.name === 'webvue_pay_return')).toBe(false)
    errors = withoutRefusals(errors)
  })

  test('a start refused because the invoice is no longer payable reads the invoice again and tells the truth', async ({ page }) => {
    const withoutRefusals = trackRefusedRequests(page, '/api/v1/public/payments')
    await openPayable(page)
    let started = false
    await page.route('**/api/v1/public/payments/invoices/2/transactions', async (route) => {
      started = true
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'not_payable', message: 'not payable' }) })
    })
    await page.route('**/api/v1/public/payments/invoices/2?*', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 2, merchant: 'ويب فيو', number: 'INV/2026/0002', due_date: '2026-10-31', currency: 'SAR', amount_total: 16905, amount_due: 0, status: 'paid', options: [] }),
    }))
    await payButton(page).click()
    await expect.poll(() => started).toBe(true)
    await expect(page.getByTestId('pay-paid')).toContainText('تم سداد هذه الفاتورة')
    await expect(payButton(page)).toHaveCount(0)
    errors = withoutRefusals(errors)
  })

  test('says the invoice is paid, with no way to pay again', async ({ page }) => {
    await page.goto(PAY(4))
    await expect(page.getByTestId('pay-paid')).toContainText('تم سداد هذه الفاتورة')
    await expect(page.getByTestId('pay-amount-due')).toHaveText('0.00 SAR')
    await expect(payButton(page)).toHaveCount(0)
    await expect(page.getByTestId('pay-options')).toHaveCount(0)
  })

  test('says the payment is being confirmed, and offers to read it again', async ({ page }) => {
    await page.goto(PAY(6))
    await expect(page.getByTestId('pay-processing')).toContainText('الدفع قيد التأكيد')
    await expect(payButton(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'تحديث الحالة' })).toBeVisible()
  })

  test('says an invoice that cannot be paid cannot be paid, and shows its due date as missing', async ({ page }) => {
    await page.goto(PAY(8))
    await expect(page.getByTestId('pay-not-payable')).toContainText('لا يمكن دفع هذه الفاتورة الآن')
    await expect(page.getByTestId('pay-due-date')).toContainText('لا قيمة')
    await expect(payButton(page)).toHaveCount(0)
  })

  test('with no live gateway the invoice is payable but offers no method: a clear message and no pay button', async ({ page }) => {
    await page.goto(PAY(9))
    await expect(page.getByTestId('pay-no-options')).toContainText('الدفع الإلكتروني غير متاح حاليًا لهذه الفاتورة')
    await expect(page.getByTestId('pay-no-options')).toContainText('تواصل مع الجهة المصدرة للفاتورة')
    await expect(payButton(page)).toHaveCount(0)
    await expect(page.getByTestId('pay-options')).toHaveCount(0)
  })

  for (const [name, path] of [
    ['a wrong token', PAY(2, 'wrong')],
    ['an invoice that does not exist (or is a draft)', PAY(1)],
    ['no token', '/pay/invoice/2'],
    ['a token of another shape', '/pay/invoice/2?access_token=a%20b'],
    ['an id that is not a number', PAY(2).replace('/2?', '/abc?')],
  ] as const) {
    test(`${name}: the link is invalid, never a sign-in page and never invoice data`, async ({ page }) => {
      const withoutRefusals = trackRefusedRequests(page, '/api/v1/public/payments')
      await page.goto(path)
      await expect(page.getByTestId('pay-invalid')).toContainText('رابط الدفع غير صالح')
      await expect(page.getByTestId('pay-invalid')).toContainText('الجهة المصدرة للفاتورة')
      await expect(page).not.toHaveURL(/\/login/)
      await expect(page.getByTestId('pay-amount-due')).toHaveCount(0)
      await expect(payButton(page)).toHaveCount(0)
      errors = withoutRefusals(errors)
    })
  }

  test('when the service cannot answer it says so and offers to try again', async ({ page }) => {
    const withoutRefusals = trackRefusedRequests(page, '/api/v1/public/payments')
    await page.goto(PAY(10))
    await expect(page.getByTestId('pay-unavailable')).toContainText('تعذّر تحميل الفاتورة')
    await expect(page.getByTestId('pay-invalid')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'إعادة المحاولة' })).toBeVisible()
    await expect(payButton(page)).toHaveCount(0)
    errors = withoutRefusals(errors)
  })

  test('fits a 375px phone with no horizontal scroll and a full-width button', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await openPayable(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const box = await payButton(page).boundingBox()
    expect(box!.width).toBeGreaterThan(280)
  })
})

test.describe('the status page', () => {
  test('says paid straight away for a paid invoice', async ({ page }) => {
    await page.goto(STATUS(4))
    await expect(heading(page, 'حالة الدفع')).toBeVisible()
    await expect(page.getByTestId('pay-status-paid')).toBeVisible()
  })

  test('says processing for an invoice whose payment is being confirmed', async ({ page }) => {
    await page.goto(STATUS(6))
    await expect(page.getByTestId('pay-status-processing')).toContainText('الدفع قيد التأكيد')
  })

  test('says an invoice that cannot be paid cannot be paid', async ({ page }) => {
    await page.goto(STATUS(8))
    await expect(page.getByTestId('pay-status-not-payable')).toBeVisible()
  })

  test('reads an invalid link as invalid', async ({ page }) => {
    const withoutRefusals = trackRefusedRequests(page, '/api/v1/public/payments')
    await page.goto(STATUS(2, 'wrong'))
    await expect(page.getByTestId('pay-invalid')).toBeVisible()
    errors = withoutRefusals(errors)
  })

  test('follows an invoice from confirming to processing to paid by re-reading it every few seconds', async ({ page }) => {
    const answers = ['processing', 'paid']
    let reads = 0
    await page.route('**/api/v1/public/payments/invoices/2?*', async (route) => {
      const status = answers[Math.min(reads++, answers.length - 1)]
      const body = { id: 2, merchant: 'ويب فيو', number: 'INV/2026/0002', due_date: '2026-10-31', currency: 'SAR', amount_total: 16905, amount_due: status === 'paid' ? 0 : 16905, status, options: [] }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PayableInvoiceSchema.parse(body)) })
    })
    await page.goto(STATUS(2))
    await expect(page.getByTestId('pay-status-confirming')).toBeVisible()
    await expect(page.getByTestId('pay-status-processing')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('pay-status-paid')).toBeVisible({ timeout: 10_000 })
    expect(reads).toBeGreaterThanOrEqual(2)
    // Once paid it stops asking.
    const settled = reads
    await page.waitForTimeout(4000)
    expect(reads).toBe(settled)
  })

  test('after a minute without a confirmation an unpaid invoice is not paid, with the way back to try again', async ({ page }) => {
    await page.clock.install()
    await page.goto(STATUS(2))
    await expect(page.getByTestId('pay-status-confirming')).toBeVisible()
    await expect(async () => {
      await page.clock.fastForward(61_000)
      await expect(page.getByTestId('pay-status-not-paid')).toBeVisible({ timeout: 1000 })
    }).toPass()
    await expect(page.getByTestId('pay-status-not-paid')).toContainText('لم يتم الدفع')
    await page.getByTestId('pay-try-again').click()
    await expect(page).toHaveURL(/\/pay\/invoice\/2\?access_token=tok-2$/)
    await expect(payButton(page)).toBeEnabled()
  })
})

test('the returned page says the result was received and what to do next', async ({ page }) => {
  await page.goto('/pay/returned')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(heading(page, 'تم استلام نتيجة الدفع')).toBeVisible()
  await expect(page.getByTestId('pay-returned')).toContainText('يمكنك إغلاق هذه الصفحة')
  await expect(page.getByTestId('pay-returned')).toContainText('افتح رابط الدفع الذي وصلك مرة أخرى')
})

test('the return without a remembered link lands on the returned page', async ({ page }) => {
  await page.goto('/payment/paymob/return?success=true')
  await expect(page).toHaveURL(/\/pay\/returned$/)
  await expect(page.getByTestId('pay-returned')).toBeVisible()
})

test.describe('the payment link action on a customer invoice', () => {
  const paymentLink = (page: Page) => page.getByTestId('finance-invoice-payment-link')
  const ready = (page: Page, path: string) => open(page, path, 'INV/2026/0002')

  test.beforeEach(async ({ page }) => {
    await login(page)
    expect((await page.request.post('/api/v1/__mock/reset-payments', { data: {} })).status()).toBe(200)
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  })

  const setGateway = async (page: Page, state: 'test' | 'enabled') => {
    const response = await page.request.patch('/api/v1/payments/providers/7', { data: { credentials: CREDENTIALS, state } })
    expect(response.status()).toBe(200)
  }

  test('copies the customer\'s address, which opens the pay page for someone with no session', async ({ page, browser, baseURL }) => {
    await setGateway(page, 'enabled')
    await ready(page, '/finance/sales/invoices/2')
    await expect(paymentLink(page)).toBeEnabled()
    await paymentLink(page).click()
    await expect(toast(page, 'تم نسخ رابط الدفع')).toBeVisible()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toBe(`${new URL(page.url()).origin}/pay/invoice/2?access_token=tok-2`)

    const customer = await browser.newContext({ baseURL, locale: 'ar-SA' })
    const customerPage = await customer.newPage()
    await customerPage.goto(copied)
    await expect(heading(customerPage, 'دفع الفاتورة')).toBeVisible()
    await expect(customerPage.getByTestId('pay-amount-due')).toHaveText('16,905.00 SAR')
    await expect(customerPage.getByTestId('pay-submit')).toBeEnabled()
    await customer.close()
  })

  test('is offered for a customer invoice paid in part', async ({ page }) => {
    await open(page, '/finance/sales/invoices/3', 'INV/2026/0003')
    await expect(paymentLink(page)).toBeVisible()
  })

  test('says to switch a gateway to live first, with no gateway on and with only test mode', async ({ page }) => {
    const withoutRefusals = trackRefusedRequests(page, '/api/v1/payments/links')
    await ready(page, '/finance/sales/invoices/2')
    await expect(paymentLink(page)).toBeEnabled()
    await paymentLink(page).click()
    await expect(toast(page, 'تعذّر إنشاء رابط الدفع')).toBeVisible()
    await expect(toast(page, 'فعّل بوابة دفع في الوضع المباشر أولًا')).toHaveCount(1)
    await setGateway(page, 'test')
    await paymentLink(page).click()
    await expect(toast(page, 'فعّل بوابة دفع في الوضع المباشر أولًا')).toHaveCount(2)
    errors = withoutRefusals(errors)
  })

  test('words a refusal because the invoice cannot be paid by link', async ({ page }) => {
    await setGateway(page, 'enabled')
    const withoutRefusals = trackRefusedRequests(page, '/api/v1/payments/links')
    await open(page, '/finance/sales/invoices/6', 'INV/2026/0006')
    await expect(paymentLink(page)).toBeEnabled()
    await paymentLink(page).click()
    await expect(toast(page, 'هذه الفاتورة لا تقبل الدفع بالرابط')).toBeVisible()
    errors = withoutRefusals(errors)
  })

  for (const [name, path] of [
    ['a draft', '/finance/sales/invoices/1'],
    ['a paid invoice', '/finance/sales/invoices/4'],
    ['a credit note', '/finance/sales/credit-notes/8'],
    ['a vendor bill', '/finance/purchases/bills/11'],
  ] as const) {
    test(`is not offered for ${name}`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByTestId('finance-invoice-state')).toBeVisible()
      await expect(page.getByTestId('finance-invoice-pdf').or(page.getByTestId('finance-invoice-post'))).toBeVisible()
      await expect(paymentLink(page)).toHaveCount(0)
    })
  }

  test('is not offered to a user without payments.links.manage, and the route refuses them', async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: 'mock_caps', value: 'reader', url: baseURL! }])
    await page.goto('/finance/sales/invoices/2')
    await expect(page.getByTestId('finance-invoice-state')).toBeVisible()
    await expect(page.getByTestId('finance-invoice-pdf')).toBeVisible()
    await expect(paymentLink(page)).toHaveCount(0)
    expect((await page.request.post('/api/v1/payments/links', { data: { invoice_id: 2 } })).status()).toBe(403)
  })
})
