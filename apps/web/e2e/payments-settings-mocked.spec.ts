import { expect, test, type Page } from '@playwright/test'
import { PaymentProviderListSchema, PaymentSettingsSchema } from '@webvue/contracts'
import { collectBrowserErrors, MOCK_STACK_ONLY, openPage as open, trackRefusedRequests } from './support/mock-pages'
import { login } from './support/tasmim6'

test.skip(process.env.E2E_PROJECT_POPUPS !== '1', MOCK_STACK_ONLY)

// The payments settings page against the stateful gateway of payments-mock-routes.mjs: the tenant connects its own
// Paymob account. A secret key containing "reject" is refused by the gateway, one containing "nomethods" leaves the
// gateway account without a payment method WebVue needs. The orders card reads and saves `/api/v1/payments/settings`
// with the revision it was made from; a save made on a stale revision answers 409.
const PATH = '/settings/apps/payments'
const FIELDS = ['paymob_public_key', 'paymob_secret_key', 'paymob_hmac_key', 'paymob_api_key'] as const
let errors: string[]

test.beforeEach(async ({ page }) => {
  await login(page)
  expect((await page.request.post('/api/v1/__mock/reset-payments', { data: {} })).status()).toBe(200)
  errors = collectBrowserErrors(page)
})

test.afterEach(() => {
  expect(errors, 'no page error and no console error').toEqual([])
})

const credential = (page: Page, field: (typeof FIELDS)[number]) => page.getByTestId(`payments-credential-${field}`)
const present = (page: Page) => Promise.all(FIELDS.map(field => page.getByTestId(`payments-present-${field}`).innerText()))

async function saveAllKeys(page: Page, secret = 'sk_test_1') {
  for (const field of FIELDS) await credential(page, field).fill(field === 'paymob_secret_key' ? secret : `${field}_value`)
  await page.getByTestId('payments-save').click()
  await expect(page.getByTestId('payments-present-paymob_api_key')).toHaveText('محفوظ')
}

test.describe('payments settings', () => {
  test('lists the gateway off, with keys not entered, and the modes that take payments locked until every key is saved', async ({ page }) => {
    await open(page, PATH, 'الدفع الإلكتروني')
    await expect(page.getByTestId('payments-state')).toHaveText('متوقف')
    expect(await present(page)).toEqual(Array(FIELDS.length).fill('غير مُدخل'))
    await expect(page.getByTestId('payments-mode-test')).toBeDisabled()
    await expect(page.getByTestId('payments-mode-enabled')).toBeDisabled()
    await expect(page.getByTestId('payments-sync')).toBeDisabled()
    await expect(page.getByTestId('payments-methods')).toHaveCount(0)
    const list = PaymentProviderListSchema.parse(await (await page.request.get('/api/v1/payments/providers')).json())
    expect(list.items[0]!.account_country_options).toEqual(['SA', 'AE', 'OM', 'EG'])
    await expect(page.getByTestId('payments-country')).toContainText('المملكة العربية السعودية')
  })

  test('keys are password inputs, never filled back, and a save sends only the fields that were typed', async ({ page }) => {
    await open(page, PATH, 'الدفع الإلكتروني')
    for (const field of FIELDS) await expect(credential(page, field)).toHaveAttribute('type', 'password')
    const bodies: unknown[] = []
    page.on('request', request => { if (request.method() === 'PATCH') bodies.push(request.postDataJSON()) })
    await credential(page, 'paymob_public_key').fill('  pk_1  ')
    await credential(page, 'paymob_secret_key').fill('sk_1')
    await page.getByTestId('payments-save').click()
    await expect(page.getByTestId('payments-present-paymob_secret_key')).toHaveText('محفوظ')
    expect(bodies).toEqual([{ credentials: { paymob_public_key: 'pk_1', paymob_secret_key: 'sk_1' } }])
    expect(await present(page)).toEqual(['محفوظ', 'محفوظ', 'غير مُدخل', 'غير مُدخل'])
    for (const field of FIELDS) await expect(credential(page, field)).toHaveValue('')
    await expect(page.getByTestId('payments-credential-paymob_public_key')).toHaveAttribute('placeholder', 'اتركه فارغًا للإبقاء على المحفوظ')
    await expect(page.getByTestId('payments-mode-test')).toBeDisabled()
  })

  test('test mode switches at once, and live asks inline first and can be cancelled', async ({ page }) => {
    await open(page, PATH, 'الدفع الإلكتروني')
    await saveAllKeys(page)
    await page.getByTestId('payments-mode-test').click()
    await expect(page.getByTestId('payments-state')).toHaveText('تجريبي')
    await expect(page.getByTestId('payments-methods')).toContainText('card')

    await page.getByTestId('payments-mode-enabled').click()
    await expect(page.getByTestId('inline-confirm')).toBeVisible()
    await expect(page.getByTestId('payments-state')).toHaveText('تجريبي')
    await page.getByTestId('inline-confirm-cancel').click()
    await expect(page.getByTestId('inline-confirm')).toHaveCount(0)
    await expect(page.getByTestId('payments-state')).toHaveText('تجريبي')

    await page.getByTestId('payments-mode-enabled').click()
    await page.getByTestId('inline-confirm-action').click()
    await expect(page.getByTestId('payments-state')).toHaveText('مباشر')
    await page.reload()
    await expect(page.getByTestId('payments-state')).toHaveText('مباشر')
  })

  test('the account country is a select of the offered countries and saves at once', async ({ page }) => {
    await open(page, PATH, 'الدفع الإلكتروني')
    await page.getByTestId('payments-country').click()
    await page.getByRole('option', { name: 'مصر' }).click()
    await expect(page.getByTestId('payments-country')).toContainText('مصر')
    await page.reload()
    await expect(page.getByTestId('payments-country')).toContainText('مصر')
  })

  test('the connection test shows a working connection, then a gateway account missing a method as a warning', async ({ page }) => {
    await open(page, PATH, 'الدفع الإلكتروني')
    await saveAllKeys(page)
    await page.getByTestId('payments-mode-test').click()
    await expect(page.getByTestId('payments-state')).toHaveText('تجريبي')
    await page.getByTestId('payments-sync').click()
    await expect(page.getByTestId('payments-sync-synced')).toBeVisible()
    await expect(page.getByTestId('payments-methods')).toContainText('apple_pay')
    // The gateway account loses a method after the keys were accepted: the test answers 200 with `methods_missing`.
    await page.route('**/api/v1/payments/providers/7/sync', async (route) => {
      const { provider } = await (await route.fetch()).json()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: { ...provider, methods: ['card'] }, status: 'methods_missing' }) })
    })
    await page.getByTestId('payments-sync').click()
    await expect(page.getByTestId('payments-sync-methods_missing')).toContainText('حساب البوابة ينقصه بعض طرق الدفع')
    await expect(page.getByTestId('payments-sync-synced')).toHaveCount(0)
    await expect(page.getByTestId('payments-methods')).not.toContainText('apple_pay')
  })

  test('a change the gateway check refuses on a gateway that is on saves nothing and says what is missing', async ({ page }) => {
    await open(page, PATH, 'الدفع الإلكتروني')
    await saveAllKeys(page)
    await page.getByTestId('payments-mode-test').click()
    await expect(page.getByTestId('payments-state')).toHaveText('تجريبي')
    const withoutRefusals = trackRefusedRequests(page, '/api/v1/payments/providers')
    await credential(page, 'paymob_secret_key').fill('sk_nomethods')
    await expect(page.getByTestId('payments-sync')).toBeDisabled()
    await page.getByTestId('payments-save').click()
    await expect(page.getByTestId('payments-credentials-error')).toContainText('حسابك لدى البوابة لا يفعّل طريقة دفع يحتاجها ويب فيو')
    await expect(credential(page, 'paymob_secret_key')).toHaveValue('sk_nomethods')
    errors = withoutRefusals(errors)
  })

  test('a gateway that refuses the keys saves nothing and keeps the typed keys for another try', async ({ page }) => {
    await open(page, PATH, 'الدفع الإلكتروني')
    await saveAllKeys(page)
    await page.getByTestId('payments-mode-test').click()
    await expect(page.getByTestId('payments-state')).toHaveText('تجريبي')
    const withoutRefusals = trackRefusedRequests(page, '/api/v1/payments/providers')
    await credential(page, 'paymob_secret_key').fill('sk_reject')
    await page.getByTestId('payments-save').click()
    await expect(page.getByTestId('payments-credentials-error')).toContainText('تعذّر الاتصال بالبوابة أو رفضت المفاتيح')
    await expect(credential(page, 'paymob_secret_key')).toHaveValue('sk_reject')
    await expect(page.getByTestId('payments-state')).toHaveText('تجريبي')
    errors = withoutRefusals(errors)
  })

  test('a refusal that names a key is shown under that key, not as a second message on the card', async ({ page }) => {
    await open(page, PATH, 'الدفع الإلكتروني')
    await page.route('**/api/v1/payments/providers/7', route => route.request().method() === 'PATCH'
      ? route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 'invalid', message: 'invalid', field: 'credentials.paymob_hmac_key' }) })
      : route.fallback())
    const withoutRefusals = trackRefusedRequests(page, '/api/v1/payments/providers')
    await credential(page, 'paymob_hmac_key').fill('hmac')
    await page.getByTestId('payments-save').click()
    await expect(credential(page, 'paymob_hmac_key')).toHaveAttribute('aria-invalid', 'true')
    await expect(credential(page, 'paymob_api_key')).not.toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByText('قيمة غير صالحة. تأكد من نسخ المفتاح كاملًا.')).toHaveCount(1)
    await expect(page.getByTestId('payments-credentials-error')).toHaveText('تعذّر حفظ المفاتيح')
    await expect(credential(page, 'paymob_hmac_key')).toHaveValue('hmac')
    errors = withoutRefusals(errors)
  })

  test('a reader without the capability gets the forbidden page and the routes answer 403', async ({ page }) => {
    await page.goto('/login')
    await page.context().addCookies([{ name: 'mock_caps', value: 'reader', url: new URL(page.url()).origin }])
    // The refused document is the behaviour under test; the browser logs it as a refused resource.
    const withoutRefusals = trackRefusedRequests(page, PATH)
    await page.goto(PATH)
    await expect(page.getByText('لا تملك صلاحية فتح هذه الصفحة')).toBeVisible()
    await expect(page.getByTestId('payments-provider-paymob')).toHaveCount(0)
    await expect(page.getByTestId('payments-orders')).toHaveCount(0)
    expect((await page.request.get('/api/v1/payments/providers')).status()).toBe(403)
    expect((await page.request.get('/api/v1/payments/settings')).status()).toBe(403)
    errors = withoutRefusals(errors)
  })
})

test.describe('payments orders settings', () => {
  const expiry = (page: Page) => page.locator('#payments-order-expiry')
  const invoiceWhenPaid = (page: Page) => page.locator('#payments-order-invoice-when-paid')
  const save = (page: Page) => page.getByTestId('payments-orders-save')
  const patchBodies = (page: Page) => {
    const bodies: unknown[] = []
    page.on('request', request => { if (request.method() === 'PATCH' && request.url().endsWith('/api/v1/payments/settings')) bodies.push(request.postDataJSON()) })
    return bodies
  }
  const readSettings = async (page: Page) => PaymentSettingsSchema.parse(await (await page.request.get('/api/v1/payments/settings')).json())

  test('shows the saved expiry and the invoice-when-paid choice with their scope, and saves nothing until something changes', async ({ page }) => {
    await open(page, PATH, 'الدفع الإلكتروني')
    await expect(page.getByTestId('payments-orders')).toBeVisible()
    await expect(expiry(page)).toHaveValue('60')
    await expect(invoiceWhenPaid(page)).toBeChecked()
    await expect(page.getByTestId('payments-orders')).toContainText('تسري على الشركة الحالية')
    await expect(page.getByTestId('payments-orders')).toContainText('يسري هذا الخيار على الحساب كله')
    await expect(save(page)).toBeDisabled()
    expect(await readSettings(page)).toEqual({
      unpaid_order_expiry_minutes: 60, invoice_when_paid: true, refund_policy: 'full', refund_amounts: 'due', revision: 0,
    })
  })

  test('is a part of the page\'s sidebar list, next to the gateways', async ({ page }) => {
    await open(page, PATH, 'الدفع الإلكتروني')
    await expect(page.locator('#orders')).toBeVisible()
    await expect(page.locator('#providers')).toBeVisible()
  })

  test('saves only the expiry that changed, with the revision, and shows the answer after a reload', async ({ page }) => {
    await open(page, PATH, 'الدفع الإلكتروني')
    const bodies = patchBodies(page)
    await expiry(page).fill('90')
    await expiry(page).blur()
    await expect(save(page)).toBeEnabled()
    await save(page).click()
    await expect(save(page)).toBeDisabled()
    expect(bodies).toEqual([{ revision: 0, unpaid_order_expiry_minutes: 90 }])
    await page.reload()
    await expect(expiry(page)).toHaveValue('90')
    await expect(invoiceWhenPaid(page)).toBeChecked()
    expect((await readSettings(page)).revision).toBe(1)
  })

  test('saves the tenant-wide invoice-when-paid choice alone', async ({ page }) => {
    await open(page, PATH, 'الدفع الإلكتروني')
    const bodies = patchBodies(page)
    await invoiceWhenPaid(page).click()
    await expect(invoiceWhenPaid(page)).not.toBeChecked()
    await save(page).click()
    await expect(save(page)).toBeDisabled()
    expect(bodies).toEqual([{ revision: 0, invoice_when_paid: false }])
    await page.reload()
    await expect(invoiceWhenPaid(page)).not.toBeChecked()
    await expect(expiry(page)).toHaveValue('60')
  })

  test('an empty expiry is told at the input and cannot be saved', async ({ page }) => {
    await open(page, PATH, 'الدفع الإلكتروني')
    await expiry(page).fill('')
    await expiry(page).blur()
    await expect(page.getByTestId('payments-orders')).toContainText('أدخل عددًا صحيحًا بين 5 و1440')
    await expect(save(page)).toBeDisabled()
    await expiry(page).fill('30')
    await expiry(page).blur()
    await expect(page.getByTestId('payments-orders')).not.toContainText('أدخل عددًا صحيحًا بين 5 و1440')
    await expect(save(page)).toBeEnabled()
  })

  test('a value the server refuses is shown under the expiry and keeps what was typed', async ({ page }) => {
    await open(page, PATH, 'الدفع الإلكتروني')
    await page.route('**/api/v1/payments/settings', route => route.request().method() === 'PATCH'
      ? route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 'invalid', message: 'المهلة خارج الحدود المسموحة', field: 'unpaid_order_expiry_minutes' }) })
      : route.fallback())
    const withoutRefusals = trackRefusedRequests(page, '/api/v1/payments/settings')
    await expiry(page).fill('45')
    await expiry(page).blur()
    await save(page).click()
    await expect(page.getByText('المهلة خارج الحدود المسموحة')).toHaveCount(1)
    await expect(expiry(page)).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByTestId('payments-orders-error')).toHaveCount(0)
    await expect(expiry(page)).toHaveValue('45')
    errors = withoutRefusals(errors)
  })

  test('a save made on a stale revision shows the saved values, tells the manager, and saves nothing', async ({ page }) => {
    await open(page, PATH, 'الدفع الإلكتروني')
    // Another session saves first: the card was made from revision 0, the server is now on 1.
    expect((await page.request.patch('/api/v1/payments/settings', { data: { revision: 0, unpaid_order_expiry_minutes: 120, invoice_when_paid: false } })).status()).toBe(200)
    const withoutRefusals = trackRefusedRequests(page, '/api/v1/payments/settings')
    const bodies = patchBodies(page)
    await expiry(page).fill('30')
    await expiry(page).blur()
    await save(page).click()
    await expect(page.getByTestId('payments-orders-conflict')).toContainText('تغيّرت إعدادات الطلبات منذ فتحت الصفحة')
    await expect(expiry(page)).toHaveValue('120')
    await expect(invoiceWhenPaid(page)).not.toBeChecked()
    await expect(save(page)).toBeDisabled()
    expect(bodies).toEqual([{ revision: 0, unpaid_order_expiry_minutes: 30 }])
    expect(await readSettings(page)).toEqual({
      unpaid_order_expiry_minutes: 120, invoice_when_paid: false, refund_policy: 'full', refund_amounts: 'due', revision: 1,
    })
    errors = withoutRefusals(errors)

    // Repeating the change now carries the revision the card was reloaded to, and the notice goes away.
    await expiry(page).fill('30')
    await expiry(page).blur()
    await save(page).click()
    await expect(save(page)).toBeDisabled()
    await expect(page.getByTestId('payments-orders-conflict')).toHaveCount(0)
    expect(bodies.at(-1)).toEqual({ revision: 1, unpaid_order_expiry_minutes: 30 })
    expect(await readSettings(page)).toEqual({
      unpaid_order_expiry_minutes: 30, invoice_when_paid: false, refund_policy: 'full', refund_amounts: 'due', revision: 2,
    })
  })

  test('when the saved values cannot be read after a conflict it says so and keeps the draft', async ({ page }) => {
    await open(page, PATH, 'الدفع الإلكتروني')
    expect((await page.request.patch('/api/v1/payments/settings', { data: { revision: 0, unpaid_order_expiry_minutes: 120 } })).status()).toBe(200)
    let reads = 0
    await page.route('**/api/v1/payments/settings', (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      reads++
      return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ code: 'rate_limited', message: 'too many requests' }) })
    })
    const withoutRefusals = trackRefusedRequests(page, '/api/v1/payments/settings')
    await expiry(page).fill('30')
    await expiry(page).blur()
    await save(page).click()
    await expect(page.getByTestId('payments-orders-reload-error')).toContainText('تعذّر تحديث إعدادات الطلبات')
    await expect(expiry(page)).toHaveValue('30')
    expect(reads).toBeGreaterThan(0)
    errors = withoutRefusals(errors)
  })
})
