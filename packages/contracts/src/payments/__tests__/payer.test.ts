import {
  decodePayReturn,
  encodePayReturn,
  PayableInvoiceSchema,
  PayableOrderSchema,
  PaymentLinkSchema,
  PaymentSettingsSchema,
  PaymentSettingsUpdateSchema,
  PaymentRedirectSchema,
  PaymentStartSchema,
} from '../index'

const INVOICE = {
  id: 11,
  merchant: 'My Company',
  number: 'INV/2026/00001',
  due_date: '2026-11-27',
  currency: 'SAR',
  amount_untaxed: 100,
  amount_tax: 15,
  amount_total: 115,
  amount_due: 115,
  status: 'payable',
  options: [{ provider_id: 14, provider: 'Paymob', method_id: 3, method: 'card', method_name: 'Card' }],
}

describe('PayableInvoiceSchema', () => {
  it('is strict and carries no partner data', () => {
    expect(PayableInvoiceSchema.parse(INVOICE)).toEqual(INVOICE)
    expect(Object.keys(PayableInvoiceSchema.shape).sort()).toEqual(
      ['amount_due', 'amount_tax', 'amount_total', 'amount_untaxed', 'currency', 'due_date', 'id', 'merchant', 'number', 'options', 'status'],
    )
    expect(() => PayableInvoiceSchema.parse({ ...INVOICE, partner: 'Payer' })).toThrow()
    expect(() => PayableInvoiceSchema.parse({ ...INVOICE, status: 'refunded' })).toThrow()
  })
})

describe('PayableOrderSchema', () => {
  it('names when an unpaid order expires instead of a due date', () => {
    const { due_date: _due, ...rest } = INVOICE
    const order = { ...rest, number: 'S00012', expires_at: '2026-10-28T11:00:00Z' }
    expect(PayableOrderSchema.parse(order)).toEqual(order)
    expect(PayableOrderSchema.parse({ ...order, expires_at: null }).expires_at).toBeNull()
    expect(() => PayableOrderSchema.parse({ ...order, due_date: '2026-11-27' })).toThrow()
    expect(() => PayableOrderSchema.parse({ ...order, expires_at: '2026-10-28' })).toThrow()
  })
})

describe('PaymentStartSchema', () => {
  it('accepts only the token and the chosen option, never an amount', () => {
    const body = { access_token: 'tok', provider_id: 14, payment_method_id: 3 }
    expect(PaymentStartSchema.parse(body)).toEqual(body)
    expect(() => PaymentStartSchema.parse({ ...body, amount: 1 })).toThrow()
    expect(() => PaymentStartSchema.parse({ ...body, access_token: '' })).toThrow()
  })
})

describe('PaymentRedirectSchema', () => {
  it('describes a get or post redirect with string fields', () => {
    const redirect = { redirect: { method: 'get', url: 'https://ksa.paymob.com/unifiedcheckout/', fields: { publicKey: 'pk' } } }
    expect(PaymentRedirectSchema.parse(redirect)).toEqual(redirect)
    expect(() => PaymentRedirectSchema.parse({ redirect: { ...redirect.redirect, method: 'put' } })).toThrow()
    expect(() => PaymentRedirectSchema.parse({ redirect: { ...redirect.redirect, url: '/relative' } })).toThrow()
  })
})

describe('PaymentLinkSchema', () => {
  it('is a pay-page path with its access token, never an absolute URL', () => {
    expect(PaymentLinkSchema.parse({ path: '/pay/invoice/11?access_token=ab-12' }).path).toBe('/pay/invoice/11?access_token=ab-12')
    expect(PaymentLinkSchema.parse({ path: '/pay/order/12?access_token=cd' }).path).toBe('/pay/order/12?access_token=cd')
    expect(() => PaymentLinkSchema.parse({ path: '/pay/refund/11?access_token=x' })).toThrow()
    expect(() => PaymentLinkSchema.parse({ path: 'https://evil.example/pay/invoice/11?access_token=x' })).toThrow()
    expect(() => PaymentLinkSchema.parse({ path: '/my/invoices/11?access_token=x' })).toThrow()
  })
})

describe('PaymentSettingsSchema', () => {
  it('bounds the expiry and accepts partial changes on a revision', () => {
    const settings = { unpaid_order_expiry_minutes: 60, invoice_when_paid: true, refund_policy: 'full', refund_amounts: 'due', tax_mode: 'included', revision: 0 }
    expect(PaymentSettingsSchema.parse(settings)).toEqual(settings)
    expect(() => PaymentSettingsSchema.parse({ ...settings, unpaid_order_expiry_minutes: 4 })).toThrow()
    expect(() => PaymentSettingsSchema.parse({ ...settings, refund_policy: 'notice' })).toThrow()
    expect(PaymentSettingsUpdateSchema.parse({ revision: 1, refund_amounts: 'any' })).toEqual({ revision: 1, refund_amounts: 'any' })
    expect(PaymentSettingsUpdateSchema.parse({ revision: 1, invoice_when_paid: false })).toEqual({ revision: 1, invoice_when_paid: false })
    expect(PaymentSettingsUpdateSchema.parse({ revision: 1, tax_mode: 'added' })).toEqual({ revision: 1, tax_mode: 'added' })
    expect(() => PaymentSettingsUpdateSchema.parse({ revision: 1, tax_mode: 'both' })).toThrow()
    expect(() => PaymentSettingsUpdateSchema.parse({ invoice_when_paid: false })).toThrow()
    expect(() => PaymentSettingsUpdateSchema.parse({ revision: 1, unpaid_order_expiry_minutes: 1441 })).toThrow()
  })
})

describe('pay return cookie', () => {
  it('round-trips a document and token and refuses anything else', () => {
    for (const back of [{ kind: 'invoice', id: 11, accessToken: 'ab-12_C' }, { kind: 'order', id: 12, accessToken: 'tok' }] as const) {
      expect(decodePayReturn(encodePayReturn(back))).toEqual(back)
    }
    for (const value of [undefined, '', '11.tok', 'invoice.11', 'invoice.11.', 'refund.11.tok', 'invoice.x.tok', 'order.11.tok;evil', 'order.11.tok/../', `order.11.${'a'.repeat(129)}`]) {
      expect(decodePayReturn(value)).toBeNull()
    }
  })
})
