import { expect, test, type Page } from '@playwright/test'
import { SalesPublicQuotationSchema } from '@liwan/contracts'
import { collectBrowserErrors, MOCK_STACK_ONLY, trackRefusedRequests } from './support/mock-pages'
import { login } from './support/tasmim6'

test.skip(process.env.E2E_PROJECT_POPUPS !== '1', MOCK_STACK_ONLY)

// The customer's quotation page against sales-mock-routes.mjs. It is public: these tests never sign in. The mock serves
// four quotations that were sent, each with the access token `tok-<id>`: S00005 (accept or decline), S00006 (accept with
// a name and a signature), S00007 (expired) and S00008 (read only, no online answer).
const QUOTE = (id: number, token = `tok-${id}`) => `/quote/${id}?access_token=${token}`
const API = '/api/v1/public/sales/quotations'

let errors: string[]

test.beforeEach(async ({ page }) => {
  errors = collectBrowserErrors(page)
  expect((await page.request.post('/api/v1/public/sales/__mock/reset', { data: {} })).status()).toBe(200)
})

test.afterEach(() => {
  expect(errors, 'no page error and no console error').toEqual([])
})

const accept = (page: Page) => page.getByTestId('quote-accept')
const decline = (page: Page) => page.getByTestId('quote-decline')

/** Opens a quotation link and waits until its answer buttons can be pressed (the page has hydrated). */
async function openQuote(page: Page, id = 5) {
  await page.goto(QUOTE(id))
  await expect(accept(page)).toBeEnabled()
}

/** Draws a diagonal stroke across the signature box with the mouse. */
async function sign(page: Page) {
  const box = (await page.getByTestId('quote-signature-pad').boundingBox())!
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.7)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3, { steps: 6 })
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.7, { steps: 6 })
  await page.mouse.up()
}

function answers(page: Page) {
  const bodies: Record<string, unknown>[] = []
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes(`${API}/`)) bodies.push(request.postDataJSON() as Record<string, unknown>) })
  return bodies
}

test('opens with no session, in Arabic RTL, under the sender\'s name, and shows the quotation with its lines, totals and terms', async ({ page }) => {
  await page.goto(QUOTE(5))
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.getByTestId('quote-title')).toHaveText('عرض سعر S00005')
  await expect(page.getByTestId('quote-company')).toHaveText('ليوان')
  await expect(page.getByTestId('quote-customer')).toContainText('منى العتيبي')
  await expect(page.getByTestId('quote-number')).toContainText('S00005')
  await expect(page.getByTestId('quote-validity')).toContainText('14/12/2026')
  await expect(page.getByTestId('sales-lines-panel')).toContainText('باقة أساسية')
  await expect(page.getByTestId('sales-total')).toContainText('276.00')
  await expect(page.getByTestId('quote-terms')).toContainText('يسري العرض لمدة شهر من تاريخه.')
  await expect(page.getByTestId('quote-pdf')).toHaveAttribute('href', `${API}/5/pdf?access_token=tok-5`)
  await expect(accept(page)).toBeEnabled()
  await expect(decline(page)).toBeEnabled()
  await expect(page.getByTestId('quote-signature-pad')).toHaveCount(0)
  await expect(page).not.toHaveURL(/\/login/)
  const answer = SalesPublicQuotationSchema.parse(await (await page.request.get(`${API}/5?access_token=tok-5`)).json())
  expect(answer).toMatchObject({ state: 'sent', answer_mode: 'accept', can_accept: true, can_decline: true })
  const pdf = await page.request.get(`${API}/5/pdf?access_token=tok-5`)
  expect(pdf.headers()['content-type']).toBe('application/pdf')
})

test('accepting sends only the token and shows the acceptance', async ({ page }) => {
  const bodies = answers(page)
  await openQuote(page)
  await accept(page).click()
  await expect(page.getByTestId('quote-accepted')).toContainText('قبلت عرض السعر هذا')
  await expect(accept(page)).toHaveCount(0)
  await expect(decline(page)).toHaveCount(0)
  expect(bodies).toEqual([{ access_token: 'tok-5' }])
  await page.reload()
  await expect(page.getByTestId('quote-accepted')).toBeVisible()
  await expect(page.getByTestId('quote-document')).toBeVisible()
  // The staff record shows the acceptance.
  await login(page)
  await page.goto('/sales/5')
  await expect(page.getByTestId('sales-answer-status')).toHaveText('قبل العرض')
})

test('accepting with a signature needs the name and a drawing, then sends them without a data prefix', async ({ page }) => {
  const bodies = answers(page)
  await openQuote(page, 6)
  await expect(accept(page)).toHaveText('القبول والتوقيع')
  await accept(page).click()
  await expect(page.getByText('اكتب اسمك الكامل.')).toBeVisible()
  await expect(page.getByText('ارسم توقيعك لتقبل العرض.')).toBeVisible()
  expect(bodies).toEqual([])

  await page.getByTestId('quote-signed-by-input').fill('  منى العتيبي ')
  await sign(page)
  await expect(page.getByText('ارسم توقيعك لتقبل العرض.')).toHaveCount(0)
  await page.getByTestId('quote-signature-clear').click()
  await accept(page).click()
  await expect(page.getByText('ارسم توقيعك لتقبل العرض.')).toBeVisible()
  expect(bodies).toEqual([])

  await sign(page)
  await accept(page).click()
  await expect(page.getByTestId('quote-accepted')).toContainText('قبلت عرض السعر هذا')
  await expect(page.getByTestId('quote-signed-by')).toContainText('منى العتيبي')
  expect(bodies).toHaveLength(1)
  const body = bodies[0]!
  expect(Object.keys(body).sort()).toEqual(['access_token', 'signature', 'signed_by'])
  expect(body.signed_by).toBe('منى العتيبي')
  expect(String(body.signature)).toMatch(/^iVBORw0KGgo[A-Za-z0-9+/]+=*$/)
  expect(Buffer.from(String(body.signature), 'base64').length).toBeLessThanOrEqual(48 * 1024)
})

test('the signature box is reachable by keyboard to clear it', async ({ page }) => {
  await openQuote(page, 6)
  await sign(page)
  const clear = page.getByTestId('quote-signature-clear')
  await clear.focus()
  await expect(clear).toBeFocused()
  await page.keyboard.press('Enter')
  await accept(page).click()
  await expect(page.getByText('ارسم توقيعك لتقبل العرض.')).toBeVisible()
})

test('a customer with only a keyboard signs with the typed name and accepts', async ({ page }) => {
  const bodies = answers(page)
  await openQuote(page, 6)
  const typed = page.getByTestId('quote-signature-typed')
  await expect(typed).toBeDisabled()
  await page.getByTestId('quote-signed-by-input').focus()
  await page.keyboard.type('منى العتيبي')
  await expect(typed).toBeEnabled()
  await page.keyboard.press('Tab')
  await expect(typed).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('quote-signature-state')).toHaveText('تم التوقيع.')
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('quote-signature-clear')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(accept(page)).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('quote-accepted')).toContainText('قبلت عرض السعر هذا')
  expect(bodies).toHaveLength(1)
  expect(bodies[0]).toMatchObject({ access_token: 'tok-6', signed_by: 'منى العتيبي' })
  expect(String(bodies[0]!.signature)).toMatch(/^iVBORw0KGgo[A-Za-z0-9+/]+=*$/)
})

test('declining asks first, sends the trimmed reason and shows the decline', async ({ page }) => {
  const bodies = answers(page)
  await openQuote(page)
  await decline(page).click()
  await expect(page.getByText('هل تريد رفض عرض السعر؟')).toBeVisible()
  await expect(accept(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'تراجع' }).click()
  await expect(page.getByText('هل تريد رفض عرض السعر؟')).toHaveCount(0)
  await expect(accept(page)).toBeEnabled()
  expect(bodies).toEqual([])

  await decline(page).click()
  await page.getByTestId('quote-decline-reason').fill('  السعر أعلى من ميزانيتنا  ')
  await page.getByRole('button', { name: 'رفض عرض السعر' }).click()
  await expect(page.getByTestId('quote-declined')).toContainText('رفضت عرض السعر هذا')
  expect(bodies).toEqual([{ access_token: 'tok-5', reason: 'السعر أعلى من ميزانيتنا' }])
  await expect(decline(page)).toHaveCount(0)
})

test('declining without a reason sends none', async ({ page }) => {
  const bodies = answers(page)
  await openQuote(page)
  await decline(page).click()
  await page.getByRole('button', { name: 'رفض عرض السعر' }).click()
  await expect(page.getByTestId('quote-declined')).toBeVisible()
  expect(bodies).toEqual([{ access_token: 'tok-5' }])
})

test('an expired quotation says so and offers no answer, but can still be downloaded', async ({ page }) => {
  await page.goto(QUOTE(7))
  await expect(page.getByTestId('quote-expired')).toContainText('انتهت صلاحية عرض السعر')
  await expect(page.getByTestId('quote-document')).toBeVisible()
  await expect(accept(page)).toHaveCount(0)
  await expect(decline(page)).toHaveCount(0)
  await expect(page.getByTestId('quote-pdf')).toBeVisible()
})

test('a quotation sent for reading only says so and offers no answer', async ({ page }) => {
  await page.goto(QUOTE(8))
  await expect(page.getByTestId('quote-notOffered')).toContainText('عرض السعر للقراءة فقط')
  await expect(accept(page)).toHaveCount(0)
  await expect(page.getByTestId('quote-document')).toBeVisible()
})

test('a quotation the sender confirmed or cancelled is shown as such and cannot be answered', async ({ page }) => {
  await login(page)
  expect((await page.request.post('/api/v1/sales/orders/5/confirm')).ok()).toBe(true)
  expect((await page.request.post('/api/v1/sales/orders/6/cancel')).ok()).toBe(true)
  await page.goto(QUOTE(5))
  await expect(page.getByTestId('quote-confirmed')).toContainText('صار عرض السعر طلبًا')
  await expect(accept(page)).toHaveCount(0)
  await page.goto(QUOTE(6))
  await expect(page.getByTestId('quote-cancelled')).toContainText('أُلغي عرض السعر هذا')
  await expect(accept(page)).toHaveCount(0)
})

for (const [name, path] of [
  ['a wrong token', QUOTE(5, 'wrong')],
  ['a quotation that was never sent', QUOTE(1)],
  ['a quotation that does not exist', QUOTE(999)],
  ['no token', '/quote/5'],
  ['a token of another shape', '/quote/5?access_token=a%20b'],
  ['an id that is not a number', '/quote/abc?access_token=tok-5'],
] as const) {
  test(`${name}: the link is invalid, never a sign-in page and never quotation data`, async ({ page }) => {
    const withoutRefusals = trackRefusedRequests(page, API)
    await page.goto(path)
    await expect(page.getByTestId('quote-invalid')).toContainText('الرابط لا يعمل')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.getByTestId('quote-document')).toHaveCount(0)
    await expect(accept(page)).toHaveCount(0)
    errors = withoutRefusals(errors)
  })
}

test('a link of the wrong shape sends no request at all', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes(API)) requests.push(request.url()) })
  await page.goto('/quote/5?access_token=a%20b')
  await expect(page.getByTestId('quote-invalid')).toBeVisible()
  expect(requests).toEqual([])
})

test('an answer given elsewhere meanwhile is refused in words and the page tells the truth', async ({ page }) => {
  const withoutRefusals = trackRefusedRequests(page, API)
  await openQuote(page)
  expect((await page.request.post(`${API}/5/decline`, { data: { access_token: 'tok-5' } })).ok()).toBe(true)
  await accept(page).click()
  await expect(page.getByTestId('quote-declined')).toBeVisible()
  await expect(accept(page)).toHaveCount(0)
  errors = withoutRefusals(errors)
})

test('a read-only workspace refuses the answer in words and keeps the quotation open', async ({ page }) => {
  const withoutRefusals = trackRefusedRequests(page, API)
  await page.route(`**${API}/5/accept`, route => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 'branch_read_only', message: 'the workspace is read-only' }) }))
  await openQuote(page)
  await accept(page).click()
  await expect(page.getByTestId('quote-action-error')).toContainText('للقراءة فقط')
  await expect(accept(page)).toBeEnabled()
  await expect(page.getByTestId('quote-accepted')).toHaveCount(0)
  errors = withoutRefusals(errors)
})

test('the page is never cached and sends no referrer, as the token is in its address', async ({ page }) => {
  const response = await page.goto(QUOTE(5))
  expect(response!.headers()['referrer-policy']).toBe('no-referrer')
  expect(response!.headers()['cache-control']).toBe('no-store')
})
