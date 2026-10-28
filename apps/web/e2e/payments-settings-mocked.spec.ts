import { expect, test, type Page } from '@playwright/test'
import { PaymentProviderListSchema } from '@webvue/contracts'
import { collectBrowserErrors, MOCK_STACK_ONLY, openPage as open, trackRefusedRequests } from './support/mock-pages'
import { login } from './support/tasmim6'

test.skip(process.env.E2E_PROJECT_POPUPS !== '1', MOCK_STACK_ONLY)

// The payments settings page against the stateful gateway of payments-mock-routes.mjs: the tenant connects its own
// Paymob account. A secret key containing "reject" is refused by the gateway, one containing "nomethods" leaves the
// gateway account without a payment method WebVue needs.
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
    expect((await page.request.get('/api/v1/payments/providers')).status()).toBe(403)
    errors = withoutRefusals(errors)
  })
})
