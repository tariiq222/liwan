import {
  FinanceInvoiceCreateSchema,
  FinanceInvoicePatchSchema,
  FinancePartnerCreateSchema,
  FinancePartnerListSchema,
  FinancePartnerPatchSchema,
  FinancePartnerSchema,
  FinancePaymentRegisterSchema,
} from '..'

const PARTNER = {
  id: 7,
  name: 'شركة النور',
  vat: '300000000000003',
  company_registry: '1010123456',
  street: 'طريق الملك فهد',
  city: 'الرياض',
  state: null,
  country: { id: 192, name: 'Saudi Arabia' },
  is_company: true,
  customer: true,
  vendor: false,
  active: true,
}
const LINE = { name: 'خدمة استشارية', quantity: 1, price_unit: 1000, discount: 0, tax_ids: [2] }
const INVOICE = { move_type: 'out_invoice', partner_id: 7, invoice_date: '2026-10-18', lines: [LINE] }
const PAYMENT = { invoice_ids: [3], amount: 1150, payment_date: '2026-10-19', journal_id: 6 }

describe('finance partner schemas', () => {
  it('parse the exact serializer shape and the list envelope, and are strict', () => {
    expect(FinancePartnerSchema.parse(PARTNER)).toEqual(PARTNER)
    expect(FinancePartnerListSchema.parse({ items: [PARTNER], total: 1 })).toEqual({ items: [PARTNER], total: 1 })
    expect(() => FinancePartnerSchema.parse({ ...PARTNER, secret: 1 })).toThrow()
    expect(() => FinancePartnerSchema.parse({ ...PARTNER, customer: 1 })).toThrow()
  })

  it('accept a create body, reject an unknown key, a blank name and non-boolean flags', () => {
    expect(FinancePartnerCreateSchema.parse({ name: 'X', vat: '300000000000003', country_id: 192, state_id: null }))
      .toEqual({ name: 'X', vat: '300000000000003', country_id: 192, state_id: null })
    expect(() => FinancePartnerCreateSchema.parse({ name: 'X', customer_rank: 1 })).toThrow()
    expect(() => FinancePartnerCreateSchema.parse({ name: '  ' })).toThrow()
    expect(() => FinancePartnerCreateSchema.parse({ name: 'X', vendor: 'yes' })).toThrow()
    expect(() => FinancePartnerCreateSchema.parse({})).toThrow()
  })

  it('a patch needs at least one known field', () => {
    expect(FinancePartnerPatchSchema.parse({ city: 'جدة' })).toEqual({ city: 'جدة' })
    expect(() => FinancePartnerPatchSchema.parse({})).toThrow()
    expect(() => FinancePartnerPatchSchema.parse({ id: 1 })).toThrow()
  })
})

describe('finance invoice request schemas', () => {
  it('accept a create body with plain-number money', () => {
    expect(FinanceInvoiceCreateSchema.parse(INVOICE)).toEqual(INVOICE)
  })

  it('reject money as a string, an unknown key and a bad move type', () => {
    expect(() => FinanceInvoiceCreateSchema.parse({ ...INVOICE, lines: [{ ...LINE, price_unit: '1000' }] })).toThrow()
    expect(() => FinanceInvoiceCreateSchema.parse({ ...INVOICE, lines: [{ ...LINE, quantity: '1' }] })).toThrow()
    expect(() => FinanceInvoiceCreateSchema.parse({ ...INVOICE, state: 'posted' })).toThrow()
    expect(() => FinanceInvoiceCreateSchema.parse({ ...INVOICE, lines: [{ ...LINE, price: 1 }] })).toThrow()
    expect(() => FinanceInvoiceCreateSchema.parse({ ...INVOICE, move_type: 'out_receipt' })).toThrow()
    expect(() => FinanceInvoiceCreateSchema.parse({ ...INVOICE, lines: [] })).toThrow()
    expect(() => FinanceInvoiceCreateSchema.parse({ ...INVOICE, lines: [{ ...LINE, quantity: -1 }] })).toThrow()
    expect(() => FinanceInvoiceCreateSchema.parse({ ...INVOICE, lines: [{ ...LINE, price_unit: 1e12 }] })).toThrow()
    expect(FinanceInvoiceCreateSchema.parse({ ...INVOICE, lines: [{ ...LINE, quantity: 0 }] }).lines[0].quantity).toBe(0)
    expect(() => FinanceInvoiceCreateSchema.parse({ ...INVOICE, lines: [{ ...LINE, discount: 101 }] })).toThrow()
  })

  it('a patch cannot change the move type and needs at least one field', () => {
    expect(FinanceInvoicePatchSchema.parse({ ref: 'PO-1' })).toEqual({ ref: 'PO-1' })
    expect(FinanceInvoicePatchSchema.parse({ lines: [LINE] })).toEqual({ lines: [LINE] })
    expect(() => FinanceInvoicePatchSchema.parse({})).toThrow()
    expect(() => FinanceInvoicePatchSchema.parse({ move_type: 'in_invoice' })).toThrow()
  })
})

describe('FinancePaymentRegisterSchema', () => {
  it('accepts a registration and rejects a string amount, a zero amount and unknown keys', () => {
    expect(FinancePaymentRegisterSchema.parse(PAYMENT)).toEqual(PAYMENT)
    expect(() => FinancePaymentRegisterSchema.parse({ ...PAYMENT, amount: '1150' })).toThrow()
    expect(() => FinancePaymentRegisterSchema.parse({ ...PAYMENT, amount: 0 })).toThrow()
    expect(() => FinancePaymentRegisterSchema.parse({ ...PAYMENT, amount: 1e12 })).toThrow()
    expect(() => FinancePaymentRegisterSchema.parse({ ...PAYMENT, invoice_ids: [] })).toThrow()
    expect(() => FinancePaymentRegisterSchema.parse({ ...PAYMENT, state: 'paid' })).toThrow()
    expect(() => FinancePaymentRegisterSchema.parse({ ...PAYMENT, payment_date: '19/10/2026' })).toThrow()
  })
})
