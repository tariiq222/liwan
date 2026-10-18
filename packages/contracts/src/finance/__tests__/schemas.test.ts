import {
  FinanceAccountListSchema,
  FinanceAccountSchema,
  FinanceInvoiceDetailSchema,
  FinanceInvoiceListSchema,
  FinanceInvoiceSchema,
  FinanceJournalListSchema,
  FinanceJournalSchema,
  FinancePaymentListSchema,
  FinancePaymentSchema,
} from '..'

const INVOICE = {
  id: 3,
  name: 'INV/2026/00001',
  move_type: 'out_invoice',
  state: 'posted',
  payment_state: 'not_paid',
  partner: { id: 7, name: 'شركة النور' },
  journal: { id: 1, name: 'Customer Invoices' },
  invoice_date: '2026-10-18',
  invoice_date_due: null,
  currency: 'SAR',
  amount_untaxed: 1000,
  amount_tax: 150,
  amount_total: 1150,
  amount_residual: 1150,
}
const LINE = {
  id: 11,
  name: 'خدمة استشارية',
  account: { id: 40, name: '400000 Product Sales' },
  quantity: 1,
  price_unit: 1000,
  discount: 0,
  taxes: [{ id: 2, name: 'VAT 15%' }],
  price_subtotal: 1000,
  price_total: 1150,
}
const PAYMENT = {
  id: 5,
  name: 'PBNK1/2026/00001',
  payment_type: 'inbound',
  partner_type: 'customer',
  state: 'paid',
  partner: { id: 7, name: 'شركة النور' },
  journal: { id: 6, name: 'Bank' },
  date: '2026-10-18',
  memo: '',
  currency: 'SAR',
  amount: 1150,
}
const ACCOUNT = {
  id: 40, code: '400000', name: 'Product Sales', account_type: 'income', reconcile: false, currency: null,
}
const JOURNAL = { id: 1, name: 'Customer Invoices', code: 'INV', type: 'sale', currency: 'SAR' }

describe('finance schemas', () => {
  it('parse the exact serializer shapes', () => {
    expect(FinanceInvoiceSchema.parse(INVOICE)).toEqual(INVOICE)
    expect(FinancePaymentSchema.parse(PAYMENT)).toEqual(PAYMENT)
    expect(FinanceAccountSchema.parse(ACCOUNT)).toEqual(ACCOUNT)
    expect(FinanceJournalSchema.parse(JOURNAL)).toEqual(JOURNAL)
  })

  it('are strict: an unknown key is rejected', () => {
    expect(() => FinanceInvoiceSchema.parse({ ...INVOICE, secret: 1 })).toThrow()
    expect(() => FinancePaymentSchema.parse({ ...PAYMENT, secret: 1 })).toThrow()
    expect(() => FinanceAccountSchema.parse({ ...ACCOUNT, secret: 1 })).toThrow()
    expect(() => FinanceJournalSchema.parse({ ...JOURNAL, secret: 1 })).toThrow()
  })

  it('rejects an unknown move type, state or account type', () => {
    expect(() => FinanceInvoiceSchema.parse({ ...INVOICE, move_type: 'entry' })).toThrow()
    expect(() => FinanceInvoiceSchema.parse({ ...INVOICE, state: 'open' })).toThrow()
    expect(() => FinanceAccountSchema.parse({ ...ACCOUNT, account_type: 'other' })).toThrow()
  })

  it('requires the currency code on every money record', () => {
    const { currency: _invoiceCurrency, ...noInvoiceCurrency } = INVOICE
    const { currency: _paymentCurrency, ...noPaymentCurrency } = PAYMENT
    expect(() => FinanceInvoiceSchema.parse(noInvoiceCurrency)).toThrow()
    expect(() => FinancePaymentSchema.parse(noPaymentCurrency)).toThrow()
  })
})

describe('FinanceInvoiceDetailSchema', () => {
  it('adds the reference, the debit origin, the ZATCA block and the lines to the list shape', () => {
    const detail = { ...INVOICE, ref: 'PO-1', debit_origin: null, zatca: null, lines: [LINE] }
    expect(FinanceInvoiceDetailSchema.parse(detail)).toEqual(detail)
    const note = { ...detail, debit_origin: { id: 3, name: 'INV/2026/0003' } }
    expect(FinanceInvoiceDetailSchema.parse(note)).toEqual(note)
    expect(() => FinanceInvoiceDetailSchema.parse({ ...detail, debit_origin: { id: 3 } })).toThrow()
    expect(() => FinanceInvoiceDetailSchema.parse(INVOICE)).toThrow()
    expect(() => FinanceInvoiceDetailSchema.parse({ ...detail, lines: [{ ...LINE, extra: 1 }] })).toThrow()
  })

  it('carries the ZATCA block of a Saudi sale document and is strict about it', () => {
    const detail = { ...INVOICE, ref: '', debit_origin: null, lines: [LINE] }
    const zatca = { qr_code: 'AQ==', confirmation_datetime: '2026-10-18T09:30:00Z' }
    expect(FinanceInvoiceDetailSchema.parse({ ...detail, zatca })).toEqual({ ...detail, zatca })
    expect(FinanceInvoiceDetailSchema.parse({ ...detail, zatca: { qr_code: null, confirmation_datetime: null } }).zatca)
      .toEqual({ qr_code: null, confirmation_datetime: null })
    expect(() => FinanceInvoiceDetailSchema.parse({ ...detail, zatca: { ...zatca, extra: 1 } })).toThrow()
    expect(() => FinanceInvoiceDetailSchema.parse({ ...detail, zatca: { qr_code: '', confirmation_datetime: null } })).toThrow()
    expect(() => FinanceInvoiceDetailSchema.parse(detail)).toThrow()
  })
})

describe('finance list envelopes', () => {
  it('wrap rows with a total and reject extra keys or a negative total', () => {
    const lists = [
      [FinanceInvoiceListSchema, INVOICE],
      [FinancePaymentListSchema, PAYMENT],
      [FinanceAccountListSchema, ACCOUNT],
      [FinanceJournalListSchema, JOURNAL],
    ] as const
    for (const [schema, row] of lists) {
      expect(schema.parse({ items: [row], total: 1 })).toEqual({ items: [row], total: 1 })
      expect(() => schema.parse({ items: [row], total: 1, next: 2 })).toThrow()
      expect(() => schema.parse({ items: [row], total: -1 })).toThrow()
    }
  })
})
