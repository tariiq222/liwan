import { beforeEach, describe, expect, it } from 'vitest'
import { CrmOpportunitySchema, FinanceInvoiceDetailSchema, PersonRefSchema, SalesOrderListSchema, SalesOrderSchema, SalesPublicQuotationSchema, SalesQuotationAcceptSchema, SalesQuotationDeclineSchema, SalesSettingsSchema } from '@liwan/contracts'
import { crmPreviewData, crmPreviewWrite } from '../../../../e2e/crm-ui-preview-data.mjs'
import { handlePublicSales, handleSales } from '../../../../e2e/sales-mock-routes.mjs'

// The sales mock answers the shapes of the contracts and follows the server's rules, so it cannot drift.
type Handler = typeof handleSales
async function run(handler: Handler, method: string, path: string, body?: object, cookie = '', headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  let answer: { status: number; body: unknown } | undefined
  const url = new URL(`http://mock.example.test${path}`)
  const handled = await handler(
    { method, headers: { cookie, ...headers } },
    { writeHead: (status: number) => { answer = { status, body: 'binary' } }, end: () => {} },
    url.pathname,
    url,
    { json: (_res: unknown, status: number, payload: unknown) => { answer = { status, body: payload } }, readBody: async () => JSON.stringify(body ?? {}) },
  )
  expect(handled).toBe(true)
  return answer as { status: number; body: unknown }
}
const call = (method: string, path: string, body?: object, cookie = '', headers: Record<string, string> = {}) => run(handleSales, method, path, body, cookie, headers)
const publicCall = (method: string, path: string, body?: object, cookie = '') => run(handlePublicSales, method, path, body, cookie)

describe('sales mock', () => {
  beforeEach(async () => {
    await publicCall('POST', '/api/v1/public/sales/__mock/reset')
    crmPreviewWrite('POST', '/api/v1/__mock/reset-crm', {})
  })

  it('lists orders by stage, source, mine and search, in the contract shape', async () => {
    const all = SalesOrderListSchema.parse((await call('GET', '/api/v1/sales/orders')).body)
    expect(all.total).toBe(8)
    expect(SalesOrderListSchema.parse((await call('GET', '/api/v1/sales/orders?state=draft,sent')).body).items.map(item => item.id)).toEqual([1, 5, 6, 7, 8])
    expect(SalesOrderListSchema.parse((await call('GET', '/api/v1/sales/orders?state=confirmed')).body).items.map(item => item.id)).toEqual([2, 4])
    expect(SalesOrderListSchema.parse((await call('GET', '/api/v1/sales/orders?state=cancelled,confirmed')).body).items.map(item => item.id)).toEqual([2, 3, 4])
    expect(SalesOrderListSchema.parse((await call('GET', '/api/v1/sales/orders?source=online')).body).items.map(item => item.id)).toEqual([4])
    expect(SalesOrderListSchema.parse((await call('GET', '/api/v1/sales/orders?mine=true')).body).items.map(item => item.id)).toEqual([1, 3])
    expect(SalesOrderListSchema.parse((await call('GET', '/api/v1/sales/orders?q=النخيل')).body).items.map(item => item.id)).toEqual([1])
    expect((await call('GET', '/api/v1/sales/orders?state=sale')).body).toMatchObject({ code: 'invalid', field: 'state' })
    expect((await call('GET', '/api/v1/sales/orders?state=draft,sale')).body).toMatchObject({ code: 'invalid', field: 'state' })
  })

  it('reads an order with its actions, and an online order offers none of the writes', async () => {
    const draft = SalesOrderSchema.parse((await call('GET', '/api/v1/sales/orders/1')).body)
    expect(draft.actions).toMatchObject({ edit: true, confirm: true, cancel: true, assign: true, send: true })
    expect(draft).toMatchObject({ expired: false, customer_answer: null })
    expect(draft.lines.map(line => line.kind)).toEqual(['section', 'product', 'note'])
    const online = SalesOrderSchema.parse((await call('GET', '/api/v1/sales/orders/4')).body)
    expect(online).toMatchObject({ source: 'online', salesperson: null })
    expect(online.actions).toMatchObject({ edit: false, confirm: false, cancel: false, lock: false, unlock: false, assign: false, send: false })
    expect((await call('GET', '/api/v1/sales/orders/999')).status).toBe(404)
  })

  it('creates a quotation priced by the server, with the settings defaults', async () => {
    const created = await call('POST', '/api/v1/sales/orders', { customer_id: 2, lines: [{ kind: 'product', product_id: 1, quantity: 2 }, { kind: 'note', name: 'شكرًا' }] })
    expect(created.status).toBe(201)
    const order = SalesOrderSchema.parse(created.body)
    expect(order).toMatchObject({ state: 'draft', source: 'staff', amount_untaxed: 240, amount_tax: 36, amount_total: 276, terms: 'الأسعار شاملة التوصيل داخل المدينة.' })
    expect(order.validity_date).toBe('2026-12-14')
  })

  it('refuses what the server refuses', async () => {
    expect((await call('POST', '/api/v1/sales/orders', { lines: [] })).body).toMatchObject({ field: 'customer_id' })
    expect((await call('POST', '/api/v1/sales/orders', { customer_id: 2, lines: [{ kind: 'product', product_id: 1, quantity: 0 }] })).body).toMatchObject({ field: 'lines.0.quantity' })
    expect((await call('POST', '/api/v1/sales/orders', { customer_id: 2, lines: [{ kind: 'product', product_id: 1, quantity: 1, unit_price: 5 }] })).body).toMatchObject({ code: 'unknown_field', field: 'lines.0.unit_price' })
    expect((await call('POST', '/api/v1/sales/orders', { customer_id: 2, lines: [{ kind: 'product', product_id: 1, quantity: 1, discount_percent: 30 }] }, 'mock_sales=agent')).body)
      .toMatchObject({ code: 'forbidden', field: 'lines.0.discount_percent', details: { reason: 'discount_above_limit' } })
    expect((await call('POST', '/api/v1/sales/orders', { customer_id: 2 }, 'mock_caps=reader')).status).toBe(403)
  })

  it('moves documents through the state table and refuses any other move', async () => {
    expect(SalesOrderSchema.parse((await call('POST', '/api/v1/sales/orders/1/confirm')).body).state).toBe('confirmed')
    expect(SalesOrderSchema.parse((await call('POST', '/api/v1/sales/orders/1/lock')).body).locked).toBe(true)
    expect((await call('POST', '/api/v1/sales/orders/1/cancel')).body).toMatchObject({ code: 'transition_forbidden' })
    expect(SalesOrderSchema.parse((await call('POST', '/api/v1/sales/orders/1/unlock')).body).locked).toBe(false)
    expect(SalesOrderSchema.parse((await call('POST', '/api/v1/sales/orders/1/cancel')).body).state).toBe('cancelled')
    expect(SalesOrderSchema.parse((await call('POST', '/api/v1/sales/orders/1/reopen')).body).state).toBe('draft')
    expect((await call('POST', '/api/v1/sales/orders/4/cancel')).body).toMatchObject({ code: 'transition_forbidden' })
    expect((await call('PATCH', '/api/v1/sales/orders/2', { terms: 'x' })).body).toMatchObject({ code: 'transition_forbidden' })
  })

  it('edits a draft, assigns a salesperson and duplicates into a new draft', async () => {
    expect(SalesOrderSchema.parse((await call('PATCH', '/api/v1/sales/orders/1', { terms: 'جديد' })).body).terms).toBe('جديد')
    expect(SalesOrderSchema.parse((await call('POST', '/api/v1/sales/orders/1/assign', { salesperson_id: 7 })).body).salesperson?.id).toBe(7)
    expect((await call('POST', '/api/v1/sales/orders/3/assign', { salesperson_id: 7 }, 'mock_sales=agent')).status).toBe(403)
    const copy = SalesOrderSchema.parse((await call('POST', '/api/v1/sales/orders/2/duplicate')).body)
    expect(copy).toMatchObject({ state: 'draft', source: 'staff' })
    expect(copy.id).not.toBe(2)
  })

  it('lists the salespeople as a bare person list to an assign holder only', async () => {
    expect(PersonRefSchema.array().parse((await call('GET', '/api/v1/sales/salespeople')).body)).toHaveLength(3)
    expect((await call('GET', '/api/v1/sales/salespeople', undefined, 'mock_sales=agent')).status).toBe(403)
    expect(PersonRefSchema.array().parse((await call('GET', '/api/v1/sales/salespeople?q=مها')).body).map(person => person.id)).toEqual([7])
  })

  it('sends a quotation, refusing a customer with no email, an expired one and one with no product line', async () => {
    expect((await call('POST', '/api/v1/sales/orders/1/send')).body).toMatchObject({ code: 'customer_email_missing' })
    expect((await call('POST', '/api/v1/sales/orders/7/send')).body).toMatchObject({ code: 'quotation_expired' })
    // An expired quotation answers `quotation_expired` before the resend setting is looked at, as the server does.
    await call('PATCH', '/api/v1/sales/settings', { answered_resend: 'refuse', revision: 1 })
    expect((await call('POST', '/api/v1/sales/orders/7/send')).body).toMatchObject({ code: 'quotation_expired' })
    await call('PATCH', '/api/v1/sales/settings', { answered_resend: 'allow', revision: 2 })
    const empty = SalesOrderSchema.parse((await call('POST', '/api/v1/sales/orders', { customer_id: 1 })).body)
    expect((await call('POST', `/api/v1/sales/orders/${empty.id}/send`)).body).toMatchObject({ code: 'invalid', field: 'lines' })
    const created = SalesOrderSchema.parse((await call('POST', '/api/v1/sales/orders', { customer_id: 1, lines: [{ kind: 'product', product_id: 1, quantity: 1 }] })).body)
    const sent = SalesOrderSchema.parse((await call('POST', `/api/v1/sales/orders/${created.id}/send`)).body)
    expect(sent).toMatchObject({ state: 'sent', actions: { send: true, reopen: true, edit: false }, customer_answer: { mode: 'accept', acceptance_confirms: false, answer: null, signature_method: null } })
    expect(SalesOrderSchema.parse((await call('POST', `/api/v1/sales/orders/${created.id}/reopen`)).body)).toMatchObject({ state: 'draft', customer_answer: null })
    expect((await call('POST', '/api/v1/sales/orders/4/send')).body).toMatchObject({ code: 'transition_forbidden' })
    expect(SalesOrderSchema.parse((await call('GET', '/api/v1/sales/orders/7')).body)).toMatchObject({ expired: true, actions: { confirm: false, send: false } })
    expect((await call('POST', '/api/v1/sales/orders/7/confirm')).body).toMatchObject({ code: 'quotation_expired' })
  })

  it('refuses sending an answered quotation under `refuse`, and sends it again under `allow`', async () => {
    const png = 'iVBORw0KGgo'.padEnd(120, 'A')
    await publicCall('POST', '/api/v1/public/sales/quotations/6/accept', { access_token: 'tok-6', signed_by: 'منى', signature: png, signature_method: 'drawn' })
    expect(SalesOrderSchema.parse((await call('GET', '/api/v1/sales/orders/6')).body).actions).toMatchObject({ send: true, reopen: true })
    expect(SalesSettingsSchema.parse((await call('PATCH', '/api/v1/sales/settings', { answered_resend: 'refuse', signature_methods: 'draw', revision: 1 })).body)).toMatchObject({ answered_resend: 'refuse', signature_methods: 'draw' })
    expect(SalesOrderSchema.parse((await call('GET', '/api/v1/sales/orders/6')).body).actions).toMatchObject({ send: false, reopen: true })
    expect(await call('POST', '/api/v1/sales/orders/6/send')).toMatchObject({ status: 409, body: { code: 'quotation_answered' } })
    expect(SalesOrderSchema.parse((await call('GET', '/api/v1/sales/orders/5')).body)).toMatchObject({ actions: { send: true }, resend_refused: false })
    expect(SalesOrderSchema.parse((await call('GET', '/api/v1/sales/orders/6')).body).resend_refused).toBe(true)
    expect(SalesOrderSchema.parse((await call('GET', '/api/v1/sales/orders/7')).body).resend_refused).toBe(false)
    expect(SalesOrderSchema.parse((await call('POST', '/api/v1/sales/orders/6/reopen')).body)).toMatchObject({ state: 'draft', customer_answer: null, resend_refused: false })
    const resent = SalesOrderSchema.parse((await call('POST', '/api/v1/sales/orders/6/send')).body)
    expect(resent.customer_answer).toMatchObject({ answer: null, signed_by: null, signature_method: null })
    expect(SalesPublicQuotationSchema.parse((await publicCall('GET', '/api/v1/public/sales/quotations/6?access_token=tok-6')).body).signature_methods).toBe('draw')
  })

  it('takes a drawn signature only from a quotation sent under `draw`', async () => {
    await call('PATCH', '/api/v1/sales/settings', { customer_answer: 'accept_and_sign', signature_methods: 'draw', revision: 1 })
    const created = SalesOrderSchema.parse((await call('POST', '/api/v1/sales/orders', { customer_id: 1, lines: [{ kind: 'product', product_id: 1, quantity: 1 }] })).body)
    await call('POST', `/api/v1/sales/orders/${created.id}/send`)
    const accept = (body: object) => publicCall('POST', `/api/v1/public/sales/quotations/${created.id}/accept`, { access_token: `tok-${created.id}`, ...body })
    const signature = 'iVBORw0KGgo'.padEnd(120, 'A')
    expect((await accept({ signed_by: 'منى', signature, signature_method: 'typed' })).body).toMatchObject({ code: 'invalid', field: 'signature_method' })
    expect(SalesPublicQuotationSchema.parse((await accept({ signed_by: 'منى', signature, signature_method: 'drawn' })).body)).toMatchObject({ signature_methods: 'draw', answer: 'accepted' })
  })

  it('refuses a malformed customer e-mail like a missing one', async () => {
    const created = SalesOrderSchema.parse((await call('POST', '/api/v1/sales/orders', { customer_id: 3, lines: [{ kind: 'product', product_id: 1, quantity: 1 }] })).body)
    expect((await call('POST', `/api/v1/sales/orders/${created.id}/send`)).body).toMatchObject({ code: 'customer_email_missing' })
  })

  it('offers the quotation as a PDF', async () => {
    expect(await call('GET', '/api/v1/sales/orders/5/pdf')).toEqual({ status: 200, body: 'binary' })
    expect(await publicCall('GET', '/api/v1/public/sales/quotations/5/pdf?access_token=tok-5')).toEqual({ status: 200, body: 'binary' })
  })

  it('reads a sent quotation by its access token and nothing else', async () => {
    const quote = SalesPublicQuotationSchema.parse((await publicCall('GET', '/api/v1/public/sales/quotations/5?access_token=tok-5')).body)
    expect(quote).toMatchObject({ state: 'sent', answer_mode: 'accept', answer: null, can_accept: true, can_decline: true, expired: false })
    expect(SalesPublicQuotationSchema.parse((await publicCall('GET', '/api/v1/public/sales/quotations/7?access_token=tok-7')).body)).toMatchObject({ expired: true, can_accept: false, can_decline: false })
    expect(SalesPublicQuotationSchema.parse((await publicCall('GET', '/api/v1/public/sales/quotations/8?access_token=tok-8')).body)).toMatchObject({ answer_mode: 'none', can_accept: false })
    for (const path of ['/5?access_token=tok-6', '/5', '/1?access_token=tok-1', '/999?access_token=tok-999']) {
      expect(await publicCall('GET', `/api/v1/public/sales/quotations${path}`)).toEqual({ status: 404, body: { code: 'not_found', message: 'not found' } })
    }
  })

  it('accepts with the token alone, or with a name and a signature when asked, and answers once', async () => {
    const accept = (id: number, body: object) => publicCall('POST', `/api/v1/public/sales/quotations/${id}/accept`, { access_token: `tok-${id}`, ...body })
    const png = 'iVBORw0KGgo'.padEnd(120, 'A')
    expect((await accept(6, {})).body).toMatchObject({ code: 'signature_required' })
    expect((await accept(6, { signed_by: 'منى', signature: 'not a png' })).body).toMatchObject({ code: 'signature_invalid' })
    expect((await accept(6, { signed_by: 'منى', signature: `iVBORw0KGgo${'A'.repeat(70_000)}` })).body).toMatchObject({ code: 'signature_invalid' })
    expect((await accept(6, { signed_by: 'منى', signature: png })).body).toMatchObject({ code: 'invalid', field: 'signature_method' })
    expect((await accept(6, { signed_by: 'منى', signature: png, signature_method: 'scanned' })).body).toMatchObject({ code: 'invalid', field: 'signature_method' })
    expect((await accept(5, { signed_by: 'منى', signature: png })).body).toMatchObject({ code: 'unknown_field', field: 'signed_by' })
    expect((await accept(6, { signature_method: 'drawn' })).body).toMatchObject({ code: 'invalid', field: 'signature_method' })
    expect((await accept(6, { signed_by: '  ', signature: png, signature_method: 'drawn' })).body).toMatchObject({ code: 'signature_required' })
    expect((await accept(6, { signed_by: 'x'.repeat(121), signature: png, signature_method: 'drawn' })).body).toMatchObject({ code: 'signature_invalid' })
    expect((await accept(6, { signed_by: 'منى', signature: null })).body).toMatchObject({ code: 'signature_required' })
    expect((await accept(5, { signature_method: 'drawn' })).body).toMatchObject({ code: 'unknown_field', field: 'signature_method' })
    expect((await accept(5, { signature: png, signed_by: 'منى' })).body).toMatchObject({ code: 'unknown_field', field: 'signed_by' })
    expect((await accept(8, {})).body).toMatchObject({ code: 'answer_not_allowed' })
    expect((await accept(7, {})).body).toMatchObject({ code: 'quotation_expired' })
    expect(SalesQuotationAcceptSchema.parse({ access_token: 'tok-6', signed_by: 'منى', signature: png, signature_method: 'typed' }).signed_by).toBe('منى')
    const signed = SalesPublicQuotationSchema.parse((await accept(6, { signed_by: 'منى', signature: png, signature_method: 'typed' })).body)
    expect(signed).toMatchObject({ state: 'sent', answer: 'accepted', signed_by: 'منى', can_accept: false })
    expect((await accept(6, { signed_by: 'منى', signature: png, signature_method: 'typed' })).body).toMatchObject({ code: 'already_answered' })
    expect(SalesOrderSchema.parse((await call('GET', '/api/v1/sales/orders/6')).body)).toMatchObject({ customer_answer: { answer: 'accepted', signed_by: 'منى', signature_method: 'typed' }, actions: { send: true, reopen: true } })
    expect((await publicCall('POST', '/api/v1/public/sales/quotations/5/accept', { access_token: 'tok-6' })).status).toBe(404)
  })

  it('confirms the order on acceptance when the quotation was sent that way, and records a decline with its reason', async () => {
    expect(SalesSettingsSchema.parse((await call('PATCH', '/api/v1/sales/settings', { customer_answer: 'accept', acceptance_confirms: true, revision: 1 })).body)).toMatchObject({ acceptance_confirms: true })
    const created = SalesOrderSchema.parse((await call('POST', '/api/v1/sales/orders', { customer_id: 1, lines: [{ kind: 'product', product_id: 1, quantity: 1 }] })).body)
    await call('POST', `/api/v1/sales/orders/${created.id}/send`)
    const token = `tok-${created.id}`
    const accepted = SalesPublicQuotationSchema.parse((await publicCall('POST', `/api/v1/public/sales/quotations/${created.id}/accept`, { access_token: token })).body)
    expect(accepted).toMatchObject({ state: 'confirmed', answer: 'accepted' })

    const declined = SalesQuotationDeclineSchema.parse({ access_token: 'tok-5', reason: ' السعر مرتفع ' })
    const answer = SalesPublicQuotationSchema.parse((await publicCall('POST', '/api/v1/public/sales/quotations/5/decline', declined)).body)
    expect(answer).toMatchObject({ state: 'cancelled', answer: 'declined', can_accept: false, can_decline: false })
    expect(SalesOrderSchema.parse((await call('GET', '/api/v1/sales/orders/5')).body)).toMatchObject({ state: 'cancelled', actions: { send: false, cancel: false, confirm: false, reopen: true } })
    expect(SalesOrderSchema.parse((await call('GET', '/api/v1/sales/orders/5')).body).customer_answer).toMatchObject({ answer: 'declined', decline_reason: 'السعر مرتفع' })
  })

  it('keeps the settings revision and refuses a stale one or a branch manager', async () => {
    expect(SalesSettingsSchema.parse((await call('GET', '/api/v1/sales/settings')).body)).toMatchObject({ visibility: 'own', revision: 1, can_manage: true, customer_answer: 'accept', acceptance_confirms: false, answered_resend: 'allow', signature_methods: 'draw_or_type' })
    expect((await call('PATCH', '/api/v1/sales/settings', { customer_answer: 'sign', revision: 1 })).body).toMatchObject({ field: 'customer_answer' })
    expect((await call('PATCH', '/api/v1/sales/settings', { acceptance_confirms: 'yes', revision: 1 })).body).toMatchObject({ field: 'acceptance_confirms' })
    expect((await call('PATCH', '/api/v1/sales/settings', { answered_resend: 'ask', revision: 1 })).body).toMatchObject({ field: 'answered_resend' })
    expect((await call('PATCH', '/api/v1/sales/settings', { signature_methods: 'type', revision: 1 })).body).toMatchObject({ field: 'signature_methods' })
    expect(SalesSettingsSchema.parse((await call('GET', '/api/v1/sales/settings', undefined, 'mock_sales=branch')).body).can_manage).toBe(false)
    expect((await call('PATCH', '/api/v1/sales/settings', { visibility: 'all', revision: 9 })).body).toMatchObject({ code: 'conflict' })
    expect((await call('PATCH', '/api/v1/sales/settings', { discount_limit_percent: 12.5, revision: 1 })).body).toMatchObject({ field: 'discount_limit_percent' })
    const tooLong = await call('PATCH', '/api/v1/sales/settings', { validity_days: 3651, revision: 1 })
    expect(tooLong.status).toBe(422)
    expect(tooLong.body).toMatchObject({ field: 'validity_days' })
    expect(SalesSettingsSchema.parse((await call('PATCH', '/api/v1/sales/settings', { visibility: 'all', revision: 1 })).body).revision).toBe(2)
    expect((await call('PATCH', '/api/v1/sales/settings', { visibility: 'own', revision: 2 }, 'mock_sales=branch')).status).toBe(403)
  })

  describe('payment to confirm', () => {
    const LINES = [{ kind: 'product', product_id: 1, quantity: 1 }]
    const create = async (body: object = {}, cookie = '') => SalesOrderSchema.parse((await call('POST', '/api/v1/sales/orders', { customer_id: 1, lines: LINES, ...body }, cookie)).body)
    const sendIt = async (id: number) => SalesOrderSchema.parse((await call('POST', `/api/v1/sales/orders/${id}/send`)).body)
    const quote = async (id: number) => SalesPublicQuotationSchema.parse((await publicCall('GET', `/api/v1/public/sales/quotations/${id}?access_token=tok-${id}`)).body)
    const pay = (id: number) => publicCall('POST', '/api/v1/public/sales/__mock/pay', { id })

    it('carries the default in the settings and drops it while the tenant cannot take payments', async () => {
      expect(SalesSettingsSchema.parse((await call('GET', '/api/v1/sales/settings')).body)).toMatchObject({ payment_to_confirm: 'off', prepayment_percent: 50 })
      expect(SalesSettingsSchema.parse((await call('PATCH', '/api/v1/sales/settings', { payment_to_confirm: 'percent', prepayment_percent: 30, revision: 1 })).body)).toMatchObject({ payment_to_confirm: 'percent', prepayment_percent: 30 })
      const off = SalesSettingsSchema.parse((await call('GET', '/api/v1/sales/settings', undefined, 'mock_payments=off')).body)
      expect(off.payment_to_confirm).toBeUndefined()
      expect(off.prepayment_percent).toBeUndefined()
      expect((await call('PATCH', '/api/v1/sales/settings', { payment_to_confirm: 'full', revision: 2 }, 'mock_payments=off')).body).toMatchObject({ code: 'feature_not_included' })
      for (const body of [{ payment_to_confirm: 'deposit' }, { prepayment_percent: 0 }, { prepayment_percent: 101 }, { prepayment_percent: '30' }]) {
        expect((await call('PATCH', '/api/v1/sales/settings', { ...body, revision: 2 })).body).toMatchObject({ code: 'invalid', field: Object.keys(body)[0] })
      }
    })

    it('gives a new quotation the default once and keeps the choice of each', async () => {
      await call('PATCH', '/api/v1/sales/settings', { payment_to_confirm: 'percent', prepayment_percent: 30, revision: 1 })
      const first = await create()
      expect(first.payment).toMatchObject({ mode: 'percent', percent: 30, amount_required: first.amount_total * 0.3 })
      await call('PATCH', '/api/v1/sales/settings', { payment_to_confirm: 'off', revision: 2 })
      expect((await create()).payment).toMatchObject({ mode: 'off', status: 'none', link: 'none' })
      expect(SalesOrderSchema.parse((await call('GET', `/api/v1/sales/orders/${first.id}`)).body).payment?.mode).toBe('percent')
      expect((await create({ payment_to_confirm: 'full' })).payment).toMatchObject({ mode: 'full', percent: 100 })
      expect((await create({}, 'mock_payments=off')).payment).toBeNull()
    })

    it('refuses what the server refuses in a choice', async () => {
      const draft = await create()
      const patch = (body: object, cookie = '') => call('PATCH', `/api/v1/sales/orders/${draft.id}`, body, cookie)
      expect((await patch({ payment_to_confirm: 'half' })).body).toMatchObject({ code: 'invalid', field: 'payment_to_confirm' })
      expect((await patch({ prepayment_percent: 40 })).body).toMatchObject({ code: 'invalid', field: 'prepayment_percent' })
      expect((await patch({ payment_to_confirm: 'full', prepayment_percent: 40 })).body).toMatchObject({ code: 'invalid', field: 'prepayment_percent' })
      expect((await patch({ payment_to_confirm: 'full' }, 'mock_payments=off')).body).toMatchObject({ code: 'feature_not_included' })
      expect(SalesOrderSchema.parse((await patch({ payment_to_confirm: 'percent', prepayment_percent: 25 })).body).payment).toMatchObject({ mode: 'percent', percent: 25 })
      expect(SalesOrderSchema.parse((await patch({ prepayment_percent: 60 })).body).payment).toMatchObject({ percent: 60 })
      expect(SalesOrderSchema.parse((await call('GET', '/api/v1/sales/orders/4')).body).payment).toBeNull()
    })

    it('shows the pay link only to a customer who may pay, and a signature comes first', async () => {
      const order = await create({ payment_to_confirm: 'full' })
      await sendIt(order.id)
      expect((await quote(order.id)).payment).toEqual({ percent: 100, amount: order.amount_total, currency: 'SAR', pay_url: `/pay/order/${order.id}?access_token=tok-${order.id}`, state: 'payable' })
      expect(SalesOrderSchema.parse((await call('GET', `/api/v1/sales/orders/${order.id}`)).body).payment).toMatchObject({ status: 'payable', link: 'ready', held: null })
      expect((await quote(5)).payment).toBeNull()
      await call('PATCH', '/api/v1/sales/settings', { customer_answer: 'accept_and_sign', revision: 1 })
      const signing = await create({ payment_to_confirm: 'percent', prepayment_percent: 40 })
      await sendIt(signing.id)
      expect((await quote(signing.id)).payment).toMatchObject({ state: 'awaiting_signature', pay_url: null, percent: 40 })
      expect(SalesOrderSchema.parse((await call('GET', `/api/v1/sales/orders/${signing.id}`)).body).payment?.link).toBe('awaiting_signature')
      await publicCall('POST', `/api/v1/public/sales/quotations/${signing.id}/accept`, { access_token: `tok-${signing.id}`, signed_by: 'منى', signature: 'iVBORw0KGgo'.padEnd(120, 'A'), signature_method: 'drawn' })
      expect((await quote(signing.id)).payment?.state).toBe('payable')
    })

    it('confirms the order when the payment arrives and reports it on the staff page', async () => {
      const order = await create({ payment_to_confirm: 'full' })
      await sendIt(order.id)
      expect((await pay(order.id)).status).toBe(200)
      expect(SalesPublicQuotationSchema.parse((await publicCall('GET', `/api/v1/public/sales/quotations/${order.id}?access_token=tok-${order.id}`)).body)).toMatchObject({ state: 'confirmed', answer: 'accepted', payment: { state: 'paid', amount: 0, pay_url: null } })
      expect(SalesOrderSchema.parse((await call('GET', `/api/v1/sales/orders/${order.id}`)).body).payment).toMatchObject({ status: 'paid', amount_received: order.amount_total, amount_due: 0, held: null })
      // A quotation that asks for nothing takes no payment.
      expect((await pay(5)).status).toBe(404)
    })

    it('reads received until the order is confirmed, and says nothing after the staff confirm without the payment', async () => {
      await call('PATCH', '/api/v1/sales/settings', { customer_answer: 'accept_and_sign', revision: 1 })
      const signing = await create({ payment_to_confirm: 'full' })
      await sendIt(signing.id)
      await pay(signing.id)
      expect((await quote(signing.id)).payment).toEqual({ percent: 100, amount: 0, currency: 'SAR', pay_url: null, state: 'received' })
      expect(SalesOrderSchema.parse((await call('GET', `/api/v1/sales/orders/${signing.id}`)).body).payment).toMatchObject({ held: 'awaiting_signature', amount_refundable: signing.amount_total, can_refund: true })
      const unpaid = await create({ payment_to_confirm: 'full' })
      await sendIt(unpaid.id)
      await call('POST', `/api/v1/sales/orders/${unpaid.id}/confirm`)
      expect((await quote(unpaid.id)).payment).toBeNull()
      expect(SalesOrderSchema.parse((await call('GET', `/api/v1/sales/orders/${unpaid.id}`)).body).payment).toMatchObject({ link: 'none', amount_due: 0, can_refund: false, amount_refundable: 0 })
    })

    it('does not let the acceptance alone confirm a quotation that asks to be paid', async () => {
      await call('PATCH', '/api/v1/sales/settings', { acceptance_confirms: true, revision: 1 })
      const asking = await create({ payment_to_confirm: 'full' })
      await sendIt(asking.id)
      await publicCall('POST', `/api/v1/public/sales/quotations/${asking.id}/accept`, { access_token: `tok-${asking.id}` })
      expect((await quote(asking.id)).state).toBe('sent')
      const free = await create({ payment_to_confirm: 'off' })
      await sendIt(free.id)
      await publicCall('POST', `/api/v1/public/sales/quotations/${free.id}/accept`, { access_token: `tok-${free.id}` })
      expect((await quote(free.id)).state).toBe('confirmed')
    })

    describe('sending again with the money already received', () => {
      // Sent, reopened, paid on the old link (a draft holding the money), then sent again.
      async function resent(answer: 'accept' | 'none') {
        await call('PATCH', '/api/v1/sales/settings', { customer_answer: answer, revision: 1 })
        const order = await create({ payment_to_confirm: 'full' })
        await sendIt(order.id)
        await call('POST', `/api/v1/sales/orders/${order.id}/reopen`)
        await pay(order.id)
        return { order, sent: await sendIt(order.id) }
      }
      const staff = async (id: number) => SalesOrderSchema.parse((await call('GET', `/api/v1/sales/orders/${id}`)).body)

      it('never confirms by itself: the page reads received and the customer\'s new acceptance confirms', async () => {
        const { order, sent } = await resent('accept')
        expect(sent.state).toBe('sent')
        expect(sent.payment).toMatchObject({ status: 'paid', held: null, needs_attention: false, attention: null })
        expect(await quote(order.id)).toMatchObject({ state: 'sent', can_accept: true, payment: { state: 'received', pay_url: null } })
        await publicCall('POST', `/api/v1/public/sales/quotations/${order.id}/accept`, { access_token: `tok-${order.id}` })
        expect(await quote(order.id)).toMatchObject({ state: 'confirmed', payment: { state: 'paid' } })
      })

      it('under answer mode none asks the staff to confirm, who then confirm it', async () => {
        const { order, sent } = await resent('none')
        expect(sent.payment).toMatchObject({ status: 'paid', needs_attention: true, attention: 'payment_awaits_confirmation' })
        expect(await quote(order.id)).toMatchObject({ state: 'sent', can_accept: false, payment: { state: 'received' } })
        expect((await call('POST', `/api/v1/sales/orders/${order.id}/confirm`)).status).toBe(200)
        expect((await staff(order.id)).payment).toMatchObject({ needs_attention: false, attention: null })
      })

      it('refuses another customer on a draft that holds money, and keeps the same one', async () => {
        const order = await create({ payment_to_confirm: 'full' })
        await sendIt(order.id)
        await call('POST', `/api/v1/sales/orders/${order.id}/reopen`)
        await pay(order.id)
        const change = await call('PATCH', `/api/v1/sales/orders/${order.id}`, { customer_id: 2 })
        expect(change.status).toBe(422)
        expect(change.body).toMatchObject({ code: 'invalid', field: 'customer_id' })
        expect((await call('PATCH', `/api/v1/sales/orders/${order.id}`, { customer_id: 1 })).status).toBe(200)
        const free = await create({ payment_to_confirm: 'full' })
        expect((await call('PATCH', `/api/v1/sales/orders/${free.id}`, { customer_id: 2 })).status).toBe(200)
      })
    })

    it('reads no_gateway while no gateway is live', async () => {
      const order = await create({ payment_to_confirm: 'full' })
      await sendIt(order.id)
      expect(SalesOrderSchema.parse((await call('GET', `/api/v1/sales/orders/${order.id}`, undefined, 'mock_gateway=none')).body).payment).toMatchObject({ status: 'payable', link: 'no_gateway' })
    })

    describe('refunds', () => {
      const refund = (id: number, body: object, cookie = '') => call('POST', `/api/v1/sales/orders/${id}/refunds`, body, cookie)
      async function paid() {
        const order = await create({ payment_to_confirm: 'full' })
        await sendIt(order.id)
        await call('POST', `/api/v1/sales/orders/${order.id}/reopen`)
        await pay(order.id)
        return order
      }

      it('records a refund and answers the order, with the money that remains', async () => {
        const order = await paid()
        const answer = await refund(order.id, { amount: 38, reference: ' RF-1 ' })
        expect(answer.status).toBe(200)
        expect(SalesOrderSchema.parse(answer.body).payment).toMatchObject({ amount_received: order.amount_total - 38, amount_refundable: order.amount_total - 38, can_refund: true })
      })

      it('refuses what the bridge refuses, with its codes', async () => {
        const order = await paid()
        expect((await refund(order.id, { amount: order.amount_total + 1, reference: 'RF' })).body).toMatchObject({ code: 'invalid', field: 'amount' })
        expect((await refund(order.id, { amount: 0, reference: 'RF' })).body).toMatchObject({ code: 'invalid', field: 'amount' })
        expect((await refund(order.id, { amount: '5', reference: 'RF' })).body).toMatchObject({ code: 'invalid', field: 'amount' })
        expect((await refund(order.id, { amount: 5, reference: '   ' })).body).toMatchObject({ code: 'invalid', field: 'reference' })
        expect((await refund(order.id, { amount: 5, reference: 'x'.repeat(129) })).body).toMatchObject({ code: 'invalid', field: 'reference' })
        expect((await refund(order.id, { amount: 5, reference: 'RF', note: 'x' })).body).toMatchObject({ code: 'unknown_field' })
        expect((await refund(order.id, { amount: 5, reference: 'RF-2' })).status).toBe(200)
        expect((await refund(order.id, { amount: 5, reference: 'RF-2' })).body).toMatchObject({ code: 'conflict' })
        expect((await refund(order.id, { amount: 5, reference: 'RF' }, 'mock_caps=reader')).body).toMatchObject({ code: 'forbidden' })
        expect((await refund(order.id, { amount: 5, reference: 'RF' }, 'mock_payments=off')).body).toMatchObject({ code: 'feature_not_included' })
        expect((await refund(4, { amount: 5, reference: 'RF' })).body).toMatchObject({ code: 'forbidden' })
        expect((await refund(999, { amount: 5, reference: 'RF' })).status).toBe(404)
      })

      it('shows no refund action to a reader or when nothing may go back', async () => {
        const order = await paid()
        const read = async (cookie = '') => SalesOrderSchema.parse((await call('GET', `/api/v1/sales/orders/${order.id}`, undefined, cookie)).body).payment
        expect(await read()).toMatchObject({ can_refund: true })
        expect(await read('mock_caps=reader')).toMatchObject({ can_refund: false })
        await refund(order.id, { amount: order.amount_total, reference: 'ALL' })
        expect(await read()).toMatchObject({ can_refund: false, amount_refundable: 0 })
      })
    })
  })

  describe('the CRM bridge', () => {
    const lead = (id: number) => CrmOpportunitySchema.parse(crmPreviewData(`/api/v1/crm/opportunities/${id}`, new URL('http://mock.example.test/')))
    const turnOn = () => crmPreviewWrite('POST', '/api/v1/__mock/crm-win-by-order', { on: true })
    const quote = async (id: number) => call('POST', `/api/v1/crm/opportunities/${id}/orders`)
    const confirm = async (orderId: number, lines = [{ kind: 'product', product_id: 1, quantity: 2 }]) => {
      await call('PATCH', `/api/v1/sales/orders/${orderId}`, { lines })
      return call('POST', `/api/v1/sales/orders/${orderId}/confirm`)
    }

    it('is off by default: no routes, no settings, no opportunity on an order', async () => {
      expect((await call('GET', '/api/v1/crm/opportunities/2/orders')).body).toMatchObject({ code: 'feature_not_included' })
      expect((await call('POST', '/api/v1/crm/opportunities/2/orders')).body).toMatchObject({ code: 'feature_not_included' })
      const settings = SalesSettingsSchema.parse((await call('GET', '/api/v1/sales/settings')).body)
      expect(settings.opportunity_win).toBeUndefined()
      expect((await call('PATCH', '/api/v1/sales/settings', { revision: 1, opportunity_win: 'manual' })).body).toMatchObject({ code: 'feature_not_included' })
      expect(lead(2).win_by_order).toBe(false)
    })

    it('writes a draft quotation for the opportunity customer and lists it in the Sales shape', async () => {
      turnOn()
      expect(lead(2)).toMatchObject({ win_by_order: true, customer: { id: 2 } })
      const created = await quote(2)
      expect(created.status).toBe(200)
      const order = SalesOrderSchema.parse(created.body)
      expect(order).toMatchObject({ state: 'draft', lines: [], customer: { id: 2 }, opportunity: { id: 2, contact_name: 'سارة القحطاني', status: 'pending', active: true } })
      const listed = SalesOrderListSchema.parse((await call('GET', '/api/v1/crm/opportunities/2/orders')).body)
      expect(listed).toMatchObject({ total: 1, items: [{ id: order.id }] })
      expect(SalesOrderListSchema.parse((await call('GET', '/api/v1/crm/opportunities/3/orders')).body).total).toBe(0)
    })

    it('refuses what the server refuses', async () => {
      turnOn()
      expect((await quote(1)).body).toMatchObject({ code: 'invalid', field: 'customer_id', details: { reason: 'crm_opportunity_without_customer' } })
      expect((await quote(6)).body).toMatchObject({ code: 'invalid', details: { reason: 'crm_opportunity_closed' } })
      expect((await quote(999)).status).toBe(404)
      expect((await call('POST', '/api/v1/crm/opportunities/2/orders', undefined, 'mock_caps=reader')).status).toBe(403)
      expect((await call('GET', '/api/v1/crm/opportunities/2/orders', undefined, 'mock_caps=reader')).status).toBe(200)
    })

    it('wins the opportunity when an order is confirmed, adds a second order and keeps the win after a cancel', async () => {
      turnOn()
      const first = SalesOrderSchema.parse((await quote(2)).body)
      const confirmed = await confirm(first.id)
      expect(SalesOrderSchema.parse(confirmed.body)).toMatchObject({ state: 'confirmed', opportunity: { status: 'won' } })
      expect(lead(2)).toMatchObject({ status: 'won', final_price: 240, expected_revenue: 240, package: null })
      const second = SalesOrderSchema.parse((await quote(2)).body)
      await confirm(second.id, [{ kind: 'product', product_id: 1, quantity: 1 }])
      expect(lead(2).final_price).toBe(360)
      await call('POST', `/api/v1/sales/orders/${first.id}/cancel`)
      expect(lead(2)).toMatchObject({ status: 'won', final_price: 120 })
      await call('POST', `/api/v1/sales/orders/${second.id}/cancel`)
      expect(lead(2)).toMatchObject({ status: 'won', final_price: 0 })
    })

    it('follows the settings: by hand wins nothing, the taxed total wins more', async () => {
      turnOn()
      const settings = SalesSettingsSchema.parse((await call('GET', '/api/v1/sales/settings')).body)
      expect(settings).toMatchObject({ opportunity_win: 'order_confirmed', opportunity_win_amount: 'untaxed' })
      const taxed = SalesSettingsSchema.parse((await call('PATCH', '/api/v1/sales/settings', { revision: settings.revision, opportunity_win_amount: 'total' })).body)
      expect(taxed.opportunity_win_amount).toBe('total')
      expect((await call('PATCH', '/api/v1/sales/settings', { revision: taxed.revision, opportunity_win: 'sometimes' })).body).toMatchObject({ code: 'invalid', field: 'opportunity_win' })
      await confirm(SalesOrderSchema.parse((await quote(2)).body).id)
      expect(lead(2).final_price).toBe(276)
      const manual = SalesSettingsSchema.parse((await call('PATCH', '/api/v1/sales/settings', { revision: taxed.revision, opportunity_win: 'manual' })).body)
      expect(manual.opportunity_win).toBe('manual')
      await confirm(SalesOrderSchema.parse((await quote(2)).body).id)
      expect(lead(2).final_price).toBe(276)
    })
  })
  describe('the Finance bridge', () => {
    const turnOn = () => publicCall('POST', '/api/v1/public/sales/__mock/finance', { on: true })
    const order = async (id: number, cookie = '') => SalesOrderSchema.parse((await call('GET', `/api/v1/sales/orders/${id}`, undefined, cookie)).body)
    const invoice = (id: number, body: object, cookie = '', headers: Record<string, string> = {}) => call('POST', `/api/v1/sales/orders/${id}/invoices`, body, cookie, headers)
    const confirmedOrder = async () => {
      const created = SalesOrderSchema.parse((await call('POST', '/api/v1/sales/orders', { customer_id: 2, lines: [{ kind: 'product', product_id: 1, quantity: 2 }] })).body)
      await call('POST', `/api/v1/sales/orders/${created.id}/confirm`)
      return created.id
    }

    it('is off by default: no invoicing on an order, no setting and no route', async () => {
      expect((await order(2)).invoicing).toBeUndefined()
      expect(SalesSettingsSchema.parse((await call('GET', '/api/v1/sales/settings')).body).invoice_down_payment).toBeUndefined()
      expect((await call('PATCH', '/api/v1/sales/settings', { revision: 1, invoice_down_payment: 'refuse' })).body).toMatchObject({ code: 'feature_not_included' })
      expect((await invoice(2, { method: 'order' })).body).toMatchObject({ code: 'feature_not_included' })
    })

    it('invoices the whole order as a draft that finance reads with its source order', async () => {
      await turnOn()
      expect((await order(2)).invoicing).toMatchObject({ status: 'to_invoice', amount_to_invoice: 552, can_invoice: true, can_down_payment: true, invoices: [] })
      const made = SalesOrderSchema.parse((await invoice(2, { method: 'order' })).body)
      expect(made.invoicing).toMatchObject({ status: 'invoiced', amount_drafted: 552, amount_to_invoice: 0, can_invoice: false, invoices: [{ id: 9001, state: 'draft', kind: 'invoice', number: null }] })
      const detail = FinanceInvoiceDetailSchema.parse((await call('GET', '/api/v1/finance/invoices/9001')).body)
      expect(detail).toMatchObject({ state: 'draft', source_order: { id: 2, number: 'S00002' }, amount_total: 552 })
      expect((await call('POST', '/api/v1/finance/invoices/9001/post')).body).toMatchObject({ state: 'posted', name: 'INV/2026/09001' })
      expect((await order(2)).invoicing).toMatchObject({ amount_invoiced: 552, amount_drafted: 0 })
    })

    it('takes down payments by percent and by amount, and the final invoice takes what is left', async () => {
      await turnOn()
      const id = await confirmedOrder()
      expect((await order(id)).amount_total).toBe(276)
      expect(SalesOrderSchema.parse((await invoice(id, { method: 'percent', percent: 25 })).body).invoicing).toMatchObject({ amount_drafted: 69, amount_to_invoice: 207, status: 'partial' })
      expect(SalesOrderSchema.parse((await invoice(id, { method: 'amount', amount: 100 })).body).invoicing).toMatchObject({ amount_drafted: 169, amount_to_invoice: 107 })
      const final = SalesOrderSchema.parse((await invoice(id, { method: 'order' })).body).invoicing!
      expect(final.invoices.map(item => [item.kind, item.amount_total])).toEqual([['invoice', 107], ['down_payment', 100], ['down_payment', 69]])
      expect(final.status).toBe('invoiced')
      expect((await invoice(id, { method: 'percent', percent: 10 })).body).toMatchObject({ code: 'nothing_to_invoice' })
    })

    it('refuses what the server refuses', async () => {
      await turnOn()
      const id = await confirmedOrder()
      for (const [body, field] of [[{}, 'method'], [{ method: 'percent' }, 'percent'], [{ method: 'percent', percent: 0 }, 'percent'], [{ method: 'percent', percent: 101 }, 'percent'], [{ method: 'amount', amount: 0 }, 'amount'], [{ method: 'order', percent: 10 }, 'percent']] as const) {
        expect((await invoice(id, body)).body).toMatchObject({ code: 'invalid', field })
      }
      expect((await invoice(id, { method: 'amount', amount: 300 })).body).toMatchObject({ code: 'invalid', field: 'amount', details: { max_amount: 276 } })
      expect((await invoice(1, { method: 'order' })).body).toMatchObject({ code: 'order_not_confirmed' })
      expect((await invoice(4, { method: 'order' })).body).toMatchObject({ code: 'forbidden', details: { reason: 'online_order' } })
      expect((await invoice(id, { method: 'order' }, 'mock_finance=read')).status).toBe(403)
      expect((await invoice(id, { method: 'order' }, 'mock_sales=agent;')).status).toBe(200)
    })

    it('follows the down payment setting and shows nothing to a caller without finance read', async () => {
      await turnOn()
      const settings = SalesSettingsSchema.parse((await call('GET', '/api/v1/sales/settings')).body)
      expect(settings.invoice_down_payment).toBe('allow')
      expect((await call('PATCH', '/api/v1/sales/settings', { revision: settings.revision, invoice_down_payment: 'sometimes' })).body).toMatchObject({ code: 'invalid', field: 'invoice_down_payment' })
      expect(SalesSettingsSchema.parse((await call('PATCH', '/api/v1/sales/settings', { revision: settings.revision, invoice_down_payment: 'refuse' })).body).invoice_down_payment).toBe('refuse')
      expect((await order(2)).invoicing).toMatchObject({ can_invoice: true, can_down_payment: false })
      expect((await invoice(2, { method: 'percent', percent: 10 })).body).toMatchObject({ code: 'down_payment_refused', field: 'method' })
      expect((await order(2, 'mock_finance=hidden')).invoicing).toBeNull()
      expect((await order(2, 'mock_finance=read')).invoicing).toMatchObject({ can_invoice: false, can_down_payment: false })
    })

    it('lets only the salesperson or an assign holder invoice an order under the default actor, and any biller under the other', async () => {
      await turnOn()
      let settings = SalesSettingsSchema.parse((await call('GET', '/api/v1/sales/settings')).body)
      expect(settings.invoice_actor).toBe('owner')
      expect((await call('PATCH', '/api/v1/sales/settings', { revision: settings.revision, invoice_actor: 'everyone' })).body).toMatchObject({ code: 'invalid', field: 'invoice_actor' })
      // Under `own` visibility an agent does not read a colleague's order at all; `all` lets them read it, and the actor setting decides the rest.
      settings = SalesSettingsSchema.parse((await call('PATCH', '/api/v1/sales/settings', { revision: settings.revision, visibility: 'all' })).body)
      // S00002 is another salesperson's: an agent without the assign right is neither offered nor allowed to invoice it.
      expect((await order(2, 'mock_sales=agent')).invoicing).toMatchObject({ can_invoice: false, can_down_payment: false })
      expect((await invoice(2, { method: 'order' }, 'mock_sales=agent')).body).toMatchObject({ code: 'forbidden', details: { reason: 'not_the_salesperson' } })
      expect((await order(2)).invoicing).toMatchObject({ can_invoice: true })
      expect(SalesSettingsSchema.parse((await call('PATCH', '/api/v1/sales/settings', { revision: settings.revision, invoice_actor: 'any_biller' })).body).invoice_actor).toBe('any_biller')
      expect((await order(2, 'mock_sales=agent')).invoicing).toMatchObject({ can_invoice: true, can_down_payment: true })
      expect((await invoice(2, { method: 'order' }, 'mock_sales=agent')).status).toBe(200)
    })

    it('hides the setting and refuses it without Finance', async () => {
      expect(SalesSettingsSchema.parse((await call('GET', '/api/v1/sales/settings')).body).invoice_actor).toBeUndefined()
      expect((await call('PATCH', '/api/v1/sales/settings', { revision: 1, invoice_actor: 'any_biller' })).body).toMatchObject({ code: 'feature_not_included' })
    })

    it('repeats the first answer of an Idempotency-Key and refuses the key for another body', async () => {
      await turnOn()
      const id = await confirmedOrder()
      const key = { 'idempotency-key': 'sales-invoice-0001' }
      const first = await invoice(id, { method: 'percent', percent: 25 }, '', key)
      expect(first.status).toBe(200)
      const again = await invoice(id, { method: 'percent', percent: 25 }, '', key)
      expect(again).toEqual(first)
      expect(SalesOrderSchema.parse((await order(id))).invoicing!.invoices).toHaveLength(1)
      expect((await invoice(id, { method: 'percent', percent: 30 }, '', key)).body).toMatchObject({ code: 'idempotency_key_reused' })
      expect((await invoice(id, { method: 'order' }, '', { 'idempotency-key': 'short' })).body).toMatchObject({ code: 'invalid', field: 'Idempotency-Key' })
      // A refused request leaves no key, so the corrected one goes through under it.
      const refused = await invoice(id, { method: 'percent', percent: 500 }, '', { 'idempotency-key': 'sales-invoice-0002' })
      expect(refused.status).toBe(422)
      expect((await invoice(id, { method: 'percent', percent: 10 }, '', { 'idempotency-key': 'sales-invoice-0002' })).status).toBe(200)
    })

    it('keeps an order with a posted invoice from being cancelled, and cancels its draft invoices with it', async () => {
      await turnOn()
      const posted = await confirmedOrder()
      await invoice(posted, { method: 'order' })
      await call('POST', '/api/v1/finance/invoices/9001/post')
      expect((await order(posted)).actions.cancel).toBe(false)
      expect((await call('POST', `/api/v1/sales/orders/${posted}/cancel`)).body).toMatchObject({ code: 'transition_forbidden' })
      const drafted = await confirmedOrder()
      await invoice(drafted, { method: 'percent', percent: 50 })
      expect((await order(drafted, 'mock_finance=read')).actions.cancel).toBe(false)
      expect((await order(drafted, 'mock_finance=retained')).actions.cancel).toBe(false)
      expect((await order(drafted)).actions.cancel).toBe(true)
      expect(SalesOrderSchema.parse((await call('POST', `/api/v1/sales/orders/${drafted}/cancel`)).body).invoicing).toMatchObject({ status: 'none', amount_drafted: 0, invoices: [{ state: 'cancel' }] })
    })

    it('counts what payments settled on a posted invoice as paid', async () => {
      await turnOn()
      const id = await confirmedOrder()
      await invoice(id, { method: 'order' })
      await call('POST', '/api/v1/finance/invoices/9001/post')
      await publicCall('POST', '/api/v1/public/sales/__mock/invoice-paid', { id: 9001, amount: 100 })
      expect((await order(id)).invoicing).toMatchObject({ amount_paid: 100, amount_invoiced: 276, invoices: [{ payment_state: 'partial', amount_residual: 176 }] })
    })

    it('subtracts what posted credit notes settled from what is paid, never below zero', async () => {
      await turnOn()
      const id = await confirmedOrder()
      await invoice(id, { method: 'order' })
      await call('POST', '/api/v1/finance/invoices/9001/post')
      // A credit note against an unpaid invoice cancels it: nothing is paid.
      await publicCall('POST', '/api/v1/public/sales/__mock/credit-note', { id: 9001, amount: 76 })
      expect((await order(id)).invoicing).toMatchObject({ amount_paid: 0, amount_credited: 76, amount_invoiced: 276 })
      // Money paid first stays paid: the credit note settles only what the invoice still owed.
      await publicCall('POST', '/api/v1/public/sales/__mock/invoice-paid', { id: 9001, amount: 100 })
      await publicCall('POST', '/api/v1/public/sales/__mock/credit-note', { id: 9001, amount: 200 })
      expect((await order(id)).invoicing).toMatchObject({ amount_paid: 100, amount_credited: 276 })
    })
  })
})
