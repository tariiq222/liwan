import { describe, expect, it } from 'vitest'
import {
  FinanceInvoiceDetailSchema,
  SalesInvoiceActorSchema,
  SalesInvoiceDownPaymentSchema,
  SalesInvoicingStatusSchema,
  SalesOrderInvoiceBodySchema,
  SalesOrderInvoicingSchema,
  SalesOrderListSchema,
  SalesOrderSchema,
  SalesSettingsPatchSchema,
  SalesSettingsSchema,
} from '../../index'

const SETTINGS = {
  visibility: 'own', validity_days: 30, discount_limit_percent: 0, default_terms: '', customer_answer: 'accept', acceptance_confirms: false,
  answered_resend: 'allow', signature_methods: 'draw_or_type', revision: 1, can_manage: true,
}
const CURRENCY = { id: 2, name: 'SAR', symbol: 'ر.س' }
const ORDER = {
  id: 1, number: 'S00001', state: 'confirmed', locked: false, expired: false, source: 'staff', customer_answer: null, customer: { id: 2, name: 'مؤسسة النخيل' },
  salesperson: { id: 2, name: 'Admin', user_id: 2 }, validity_date: null, date: '2026-11-14T08:00:00Z', terms: '', currency: CURRENCY,
  amount_untaxed: 0, amount_tax: 0, amount_total: 0, lines: [],
  actions: { edit: false, confirm: false, cancel: true, reopen: false, lock: true, unlock: false, duplicate: true, assign: false, send: false },
  resend_refused: false,
}
const INVOICE = {
  id: 9, number: null, state: 'draft', kind: 'down_payment', payment_state: 'not_paid', invoice_date: null, invoice_date_due: '2026-11-30',
  amount_total: 54, amount_residual: 54, currency: 'SAR',
}
const INVOICING = {
  status: 'partial', amount_invoiced: 0, amount_credited: 0, amount_drafted: 54, amount_to_invoice: 126, amount_paid: 0,
  invoices: [INVOICE], can_invoice: true, can_down_payment: true,
}

describe('the invoicing of an order', () => {
  it('is absent without the bridge, null without finance read and strict when present', () => {
    expect(SalesOrderSchema.parse(ORDER).invoicing).toBeUndefined()
    expect(SalesOrderSchema.parse({ ...ORDER, invoicing: null }).invoicing).toBeNull()
    expect(SalesOrderSchema.parse({ ...ORDER, invoicing: INVOICING }).invoicing).toEqual(INVOICING)
    for (const bad of [{ status: 'paid' }, { can_invoice: 1 }, { amount_paid: '0' }, { journal: 1 }, { invoices: [{ ...INVOICE, kind: 'refund' }] }, { invoices: [{ ...INVOICE, state: 'sent' }] }, { invoices: [{ ...INVOICE, number: '' }] }]) {
      expect(() => SalesOrderInvoicingSchema.parse({ ...INVOICING, ...bad })).toThrow()
    }
    const { amount_credited: _credited, ...short } = INVOICING
    expect(() => SalesOrderInvoicingSchema.parse(short)).toThrow()
  })

  it('names exactly the statuses the server answers', () => {
    expect(SalesInvoicingStatusSchema.options).toEqual(['none', 'to_invoice', 'partial', 'invoiced'])
  })

  it('does not change the list row', () => {
    const { lines: _lines, actions: _actions, resend_refused: _refused, ...row } = ORDER
    expect(SalesOrderListSchema.parse({ items: [row], total: 1 }).items).toHaveLength(1)
    expect(() => SalesOrderListSchema.parse({ items: [{ ...row, invoicing: INVOICING }], total: 1 })).toThrow()
  })
})

describe('the invoice request', () => {
  it('takes the whole order, or a down payment by percent or by amount', () => {
    expect(SalesOrderInvoiceBodySchema.parse({ method: 'order' })).toEqual({ method: 'order' })
    expect(SalesOrderInvoiceBodySchema.parse({ method: 'percent', percent: 30 })).toEqual({ method: 'percent', percent: 30 })
    expect(SalesOrderInvoiceBodySchema.parse({ method: 'percent', percent: 33.5 })).toEqual({ method: 'percent', percent: 33.5 })
    expect(SalesOrderInvoiceBodySchema.parse({ method: 'amount', amount: 57.5 })).toEqual({ method: 'amount', amount: 57.5 })
  })

  it('refuses what the server refuses', () => {
    for (const bad of [
      {}, { method: 'half' }, { method: 'percent' }, { method: 'percent', percent: 0 }, { method: 'percent', percent: 0.5 }, { method: 'percent', percent: 101 },
      { method: 'amount' }, { method: 'amount', amount: 0 }, { method: 'amount', amount: -3 }, { method: 'order', percent: 10 }, { method: 'percent', percent: 10, amount: 5 },
      { method: 'amount', amount: '9' },
    ]) {
      expect(() => SalesOrderInvoiceBodySchema.parse(bad)).toThrow()
    }
  })
})

describe('the down payment setting', () => {
  it('is absent without Finance, one of two values with it, and written with the revision', () => {
    expect(SalesSettingsSchema.parse(SETTINGS)).toEqual(SETTINGS)
    expect(SalesSettingsSchema.parse({ ...SETTINGS, invoice_down_payment: 'refuse' }).invoice_down_payment).toBe('refuse')
    expect(SalesInvoiceDownPaymentSchema.options).toEqual(['allow', 'refuse'])
    expect(SalesSettingsPatchSchema.parse({ revision: 2, invoice_down_payment: 'allow' })).toEqual({ revision: 2, invoice_down_payment: 'allow' })
    for (const bad of [{ invoice_down_payment: 'ask' }, { invoice_down_payment: true }]) {
      expect(() => SalesSettingsSchema.parse({ ...SETTINGS, ...bad })).toThrow()
      expect(() => SalesSettingsPatchSchema.parse({ revision: 2, ...bad })).toThrow()
    }
  })
})

describe('the invoice actor setting', () => {
  it('is absent without Finance, owner or any_biller with it, and written with the revision', () => {
    expect(SalesSettingsSchema.parse(SETTINGS).invoice_actor).toBeUndefined()
    expect(SalesSettingsSchema.parse({ ...SETTINGS, invoice_actor: 'any_biller' }).invoice_actor).toBe('any_biller')
    expect(SalesInvoiceActorSchema.options).toEqual(['owner', 'any_biller'])
    expect(SalesSettingsPatchSchema.parse({ revision: 2, invoice_actor: 'owner' })).toEqual({ revision: 2, invoice_actor: 'owner' })
    for (const bad of [{ invoice_actor: 'anyone' }, { invoice_actor: true }, { invoice_actor: null }]) {
      expect(() => SalesSettingsSchema.parse({ ...SETTINGS, ...bad })).toThrow()
      expect(() => SalesSettingsPatchSchema.parse({ revision: 2, ...bad })).toThrow()
    }
  })
})

describe('the source order of a finance invoice', () => {
  const DETAIL = {
    id: 3, name: 'INV/2026/00001', move_type: 'out_invoice', state: 'draft', payment_state: 'not_paid', partner: { id: 4, name: 'مؤسسة النخيل' },
    journal: { id: 1, name: 'Sales' }, invoice_date: null, invoice_date_due: null, payment_term: null, currency: 'SAR',
    amount_untaxed: 100, amount_tax: 15, amount_total: 115, amount_residual: 115, ref: '', debit_origin: null, credit_origin: null, zatca: null,
    lines: [], allowed_actions: [], blocked_actions: [],
  }
  it('is optional, null for a caller who cannot read it, and an id and a number otherwise', () => {
    const parsed = FinanceInvoiceDetailSchema.safeParse(DETAIL)
    if (!parsed.success) throw new Error(parsed.error.message)
    expect(parsed.data.source_order).toBeUndefined()
    expect(FinanceInvoiceDetailSchema.parse({ ...DETAIL, source_order: null }).source_order).toBeNull()
    expect(FinanceInvoiceDetailSchema.parse({ ...DETAIL, source_order: { id: 5, number: 'S00005' } }).source_order).toEqual({ id: 5, number: 'S00005' })
    for (const bad of [{ id: 0, number: 'S1' }, { id: 5, number: '' }, { id: 5, number: 'S1', state: 'sale' }]) {
      expect(() => FinanceInvoiceDetailSchema.parse({ ...DETAIL, source_order: bad })).toThrow()
    }
  })
})
