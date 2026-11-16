import { describe, expect, it } from 'vitest'
import {
  SalesOrderCreateSchema,
  SalesOrderRefundBodySchema,
  SalesOrderPatchSchema,
  SalesOrderPaymentSchema,
  SalesOrderSchema,
  SalesPublicPaymentSchema,
  SalesPublicQuotationSchema,
  SalesSettingsPatchSchema,
  SalesSettingsSchema,
} from '../index'

const SETTINGS = {
  visibility: 'own', validity_days: 30, discount_limit_percent: 0, default_terms: '', customer_answer: 'accept', acceptance_confirms: false,
  answered_resend: 'allow', signature_methods: 'draw_or_type', revision: 1, can_manage: true,
}
const PAYMENT = {
  mode: 'percent', percent: 40, currency: 'SAR', amount_required: 36, amount_received: 0, amount_due: 36, amount_to_refund: 0,
  amount_refundable: 0, can_refund: false, attention: null, status: 'payable', link: 'ready', held: null, needs_attention: false,
}
const PUBLIC_PAYMENT = { percent: 40, amount: 36, currency: 'SAR', pay_url: '/pay/order/5?access_token=test-token', state: 'payable' }

describe('the payment settings of the bridge', () => {
  it('are absent without the bridge and present with it, and bounded', () => {
    expect(SalesSettingsSchema.parse(SETTINGS)).toEqual(SETTINGS)
    const withBridge = { ...SETTINGS, payment_to_confirm: 'percent', prepayment_percent: 30 }
    expect(SalesSettingsSchema.parse(withBridge)).toEqual(withBridge)
    for (const bad of [{ payment_to_confirm: 'deposit' }, { prepayment_percent: 0 }, { prepayment_percent: 101 }, { prepayment_percent: 12.5 }, { prepayment_percent: '30' }]) {
      expect(() => SalesSettingsSchema.parse({ ...withBridge, ...bad })).toThrow()
      expect(() => SalesSettingsPatchSchema.parse({ revision: 1, ...bad })).toThrow()
    }
  })

  it('are written with the revision and nothing else is needed', () => {
    expect(SalesSettingsPatchSchema.parse({ revision: 2, payment_to_confirm: 'full' })).toEqual({ revision: 2, payment_to_confirm: 'full' })
    expect(SalesSettingsPatchSchema.parse({ revision: 2, prepayment_percent: 100 })).toEqual({ revision: 2, prepayment_percent: 100 })
  })
})

describe('the choice of one quotation', () => {
  it('rides on the create and the edit and takes the same bounds', () => {
    const body = { customer_id: 5, payment_to_confirm: 'percent', prepayment_percent: 25 }
    expect(SalesOrderCreateSchema.parse(body)).toEqual(body)
    expect(SalesOrderPatchSchema.parse({ payment_to_confirm: 'off' })).toEqual({ payment_to_confirm: 'off' })
    expect(() => SalesOrderCreateSchema.parse({ customer_id: 5, payment_to_confirm: 'half' })).toThrow()
    expect(() => SalesOrderPatchSchema.parse({ prepayment_percent: 0 })).toThrow()
  })
})

describe('SalesOrderPaymentSchema', () => {
  it('accepts the serializer fields and refuses any other', () => {
    expect(SalesOrderPaymentSchema.parse(PAYMENT)).toEqual(PAYMENT)
    expect(Object.keys(SalesOrderPaymentSchema.shape).sort()).toEqual([
      'amount_due', 'amount_received', 'amount_refundable', 'amount_required', 'amount_to_refund', 'attention', 'can_refund', 'currency', 'held', 'link', 'mode',
      'needs_attention', 'percent', 'status',
    ])
    expect(SalesOrderPaymentSchema.parse({ ...PAYMENT, held: 'expired', status: 'cancelled', link: 'none' }).held).toBe('expired')
    expect(SalesOrderPaymentSchema.parse({ ...PAYMENT, held: 'cancelled', link: 'no_gateway', amount_refundable: 36, can_refund: true }).link).toBe('no_gateway')
    expect(() => SalesOrderPaymentSchema.parse({ ...PAYMENT, held: 'late' })).toThrow()
    expect(() => SalesOrderPaymentSchema.parse({ ...PAYMENT, amount_refundable: -1 })).toThrow()
    expect(SalesOrderPaymentSchema.parse({ ...PAYMENT, needs_attention: true, attention: 'payment_reversed' }).attention).toBe('payment_reversed')
    expect(() => SalesOrderPaymentSchema.parse({ ...PAYMENT, attention: 'stuck' })).toThrow()
    expect(() => SalesOrderPaymentSchema.parse({ ...PAYMENT, link: 'open' })).toThrow()
    expect(() => SalesOrderPaymentSchema.parse({ ...PAYMENT, extra: 1 })).toThrow()
    expect(() => SalesOrderPaymentSchema.parse({ ...PAYMENT, amount_due: -1 })).toThrow()
  })

  it('rides on the order as an optional, nullable field', () => {
    const base = { ...ORDER_BASE }
    expect(SalesOrderSchema.parse(base).payment).toBeUndefined()
    expect(SalesOrderSchema.parse({ ...base, payment: null }).payment).toBeNull()
    expect(SalesOrderSchema.parse({ ...base, payment: PAYMENT }).payment).toEqual(PAYMENT)
  })
})

describe('SalesOrderRefundBodySchema', () => {
  it('takes the amount and the gateway reference only', () => {
    expect(SalesOrderRefundBodySchema.parse({ amount: 36, reference: 'RF-1' })).toEqual({ amount: 36, reference: 'RF-1' })
    for (const bad of [{ amount: 0, reference: 'RF-1' }, { amount: 36, reference: ' ' }, { amount: 36 }, { amount: 36, reference: 'RF-1', order_id: 5 }]) {
      expect(() => SalesOrderRefundBodySchema.parse(bad)).toThrow()
    }
  })
})

describe('SalesPublicPaymentSchema', () => {
  it('accepts the pay page path with its own token only', () => {
    expect(SalesPublicPaymentSchema.parse(PUBLIC_PAYMENT)).toEqual(PUBLIC_PAYMENT)
    expect(SalesPublicPaymentSchema.parse({ ...PUBLIC_PAYMENT, pay_url: null, state: 'awaiting_signature' }).pay_url).toBeNull()
    for (const bad of ['https://evil.test/pay/order/5?access_token=x', '/pay/invoice/5?access_token=x', '/pay/order/5', '/pay/order/5?access_token=x&next=/', '//evil.test']) {
      expect(() => SalesPublicPaymentSchema.parse({ ...PUBLIC_PAYMENT, pay_url: bad })).toThrow()
    }
    expect(SalesPublicPaymentSchema.parse({ ...PUBLIC_PAYMENT, pay_url: null, state: 'received', amount: 0 }).state).toBe('received')
    expect(() => SalesPublicPaymentSchema.parse({ ...PUBLIC_PAYMENT, state: 'open' })).toThrow()
    expect(() => SalesPublicPaymentSchema.parse({ ...PUBLIC_PAYMENT, partner_id: 3 })).toThrow()
  })

  it('rides on the public quotation as an optional, nullable field', () => {
    expect(SalesPublicQuotationSchema.parse({ ...PUBLIC_BASE, payment: PUBLIC_PAYMENT }).payment).toEqual(PUBLIC_PAYMENT)
    expect(SalesPublicQuotationSchema.parse({ ...PUBLIC_BASE, payment: null }).payment).toBeNull()
    expect(SalesPublicQuotationSchema.parse(PUBLIC_BASE).payment).toBeUndefined()
  })
})

const ORDER_BASE = {
  id: 7, number: 'S00007', state: 'sent', locked: false, expired: false, source: 'staff', customer_answer: null, customer: { id: 5, name: 'Acme' },
  salesperson: { id: 2, name: 'Maha', user_id: 2 }, validity_date: '2026-12-14', date: '2026-11-14T08:00:00Z', terms: '',
  currency: { id: 2, name: 'SAR', symbol: 'ر.س' }, amount_untaxed: 90, amount_tax: 0, amount_total: 90, lines: [],
  actions: { edit: false, confirm: true, cancel: true, reopen: true, lock: false, unlock: false, duplicate: true, assign: false, send: true },
  resend_refused: false,
}
const PUBLIC_BASE = {
  id: 5, number: 'S00005', state: 'sent', expired: false, company_name: 'Liwan', customer_name: 'Acme', date: '2026-11-14T08:00:00Z',
  validity_date: '2026-12-14', terms: '', currency: { id: 2, name: 'SAR', symbol: 'ر.س' }, amount_untaxed: 90, amount_tax: 0, amount_total: 90,
  lines: [], answer_mode: 'accept', signature_methods: 'draw_or_type', answer: null, answered_at: null, signed_by: null, can_accept: true, can_decline: true,
}
