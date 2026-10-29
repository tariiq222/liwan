import {
  FinanceAccountListSchema,
  FinanceAccountSchema,
  FinanceInvoiceDetailSchema,
  FinanceInvoiceListSchema,
  FinanceInvoiceSchema,
  FinanceJournalListSchema,
  FinanceBankImportPreviewRequestSchema,
  FinanceBankImportSchema,
  FinanceCashFlowSchema,
  FinanceJournalSchema,
  FinanceVatReturnSchema,
  FinancePaymentAllocateSchema,
  FinancePaymentPatchSchema,
  FinancePaymentStandaloneSchema,
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
  analytic_distribution: [],
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
  unallocated: 0,
  invoices: [],
  allowed_actions: ['cancel'],
  blocked_actions: [],
}
const ACCOUNT = {
  id: 40, code: '400000', name: 'Product Sales', account_type: 'income', reconcile: false, currency: null, active: true,
}
const JOURNAL = { id: 1, name: 'Customer Invoices', code: 'INV', type: 'sale', currency: 'SAR', default_account: null, active: true }

describe('draft document numbering', () => {
  it('accepts a null payment name', () => {
    expect(FinancePaymentSchema.safeParse({ ...PAYMENT, name: null }).success).toBe(true)
  })

  it('accepts a null name on a draft invoice and rejects false', () => {
    expect(FinanceInvoiceSchema.safeParse({ ...INVOICE, state: 'draft', name: null }).success).toBe(true)
    expect(FinanceInvoiceSchema.safeParse({ ...INVOICE, name: false }).success).toBe(false)
  })
})

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

describe('the action contract of a finance record', () => {
  const detail = { ...INVOICE, ref: '', debit_origin: null, credit_origin: null, zatca: null, lines: [LINE] }

  it('carries what the server allows and why it blocks the rest', () => {
    const body = {
      ...detail,
      allowed_actions: ['pdf'],
      blocked_actions: [{ action: 'cancel', reason: 'has_payments' }, { action: 'reset_to_draft', reason: 'period_locked' }],
    }
    expect(FinanceInvoiceDetailSchema.parse(body)).toEqual(body)
  })

  it('requires both lists and is strict about an action, a reason and an extra key', () => {
    const { allowed_actions: _allowed, ...withoutAllowed } = { ...detail, allowed_actions: [], blocked_actions: [] }
    expect(() => FinanceInvoiceDetailSchema.parse(withoutAllowed)).toThrow()
    expect(() => FinanceInvoiceDetailSchema.parse({ ...detail, allowed_actions: ['launch'], blocked_actions: [] })).toThrow()
    expect(() => FinanceInvoiceDetailSchema.parse({ ...detail, allowed_actions: [], blocked_actions: [{ action: 'cancel', reason: 'because' }] })).toThrow()
    expect(() => FinanceInvoiceDetailSchema.parse({
      ...detail, allowed_actions: [], blocked_actions: [{ action: 'cancel', reason: 'has_payments', extra: 1 }],
    })).toThrow()
  })

  it('names every reason a route refuses with, including the tenant ones', () => {
    for (const reason of [
      'tenant_read_only', 'tenant_suspended', 'feature_not_included', 'period_locked',
      'has_payments', 'has_reconciliations', 'zatca_not_onboarded', 'zatca_mode_not_allowed',
    ]) {
      expect(FinanceInvoiceDetailSchema.parse({ ...detail, allowed_actions: [], blocked_actions: [{ action: 'post', reason }] }).blocked_actions[0]?.reason).toBe(reason)
    }
  })
})

describe('FinanceInvoiceDetailSchema', () => {
  it('adds the reference, the debit origin, the ZATCA block and the lines to the list shape', () => {
    const detail = { ...INVOICE, ref: 'PO-1', debit_origin: null, credit_origin: null, zatca: null, lines: [LINE], allowed_actions: ['pdf'], blocked_actions: [] }
    expect(FinanceInvoiceDetailSchema.parse(detail)).toEqual(detail)
    const note = { ...detail, debit_origin: { id: 3, name: 'INV/2026/0003' } }
    expect(FinanceInvoiceDetailSchema.parse(note)).toEqual(note)
    expect(() => FinanceInvoiceDetailSchema.parse({ ...detail, debit_origin: { id: 3 } })).toThrow()
    const credit = { ...detail, credit_origin: { id: 3, name: 'INV/2026/0003' } }
    expect(FinanceInvoiceDetailSchema.parse(credit)).toEqual(credit)
    expect(() => FinanceInvoiceDetailSchema.parse({ ...detail, credit_origin: { id: 3 } })).toThrow()
    expect(() => FinanceInvoiceDetailSchema.parse(INVOICE)).toThrow()
    expect(() => FinanceInvoiceDetailSchema.parse({ ...detail, lines: [{ ...LINE, extra: 1 }] })).toThrow()
  })

  it('carries the ZATCA block of a Saudi sale document and is strict about it', () => {
    const detail = { ...INVOICE, ref: '', debit_origin: null, credit_origin: null, lines: [LINE], allowed_actions: [], blocked_actions: [] }
    const submission = { state: 'accepted', mode: 'clearance', errors: [], warnings: [], qr_present: true }
    const zatca = { qr_code: 'AQ==', confirmation_datetime: '2026-10-18T09:30:00Z', submission }
    expect(FinanceInvoiceDetailSchema.parse({ ...detail, zatca })).toEqual({ ...detail, zatca })
    const empty = { qr_code: null, confirmation_datetime: null, submission }
    expect(FinanceInvoiceDetailSchema.parse({ ...detail, zatca: empty }).zatca).toEqual(empty)
    expect(() => FinanceInvoiceDetailSchema.parse({ ...detail, zatca: { ...zatca, extra: 1 } })).toThrow()
    expect(() => FinanceInvoiceDetailSchema.parse({ ...detail, zatca: { ...empty, qr_code: '' } })).toThrow()
    expect(() => FinanceInvoiceDetailSchema.parse({ ...detail, zatca: { qr_code: null, confirmation_datetime: null } })).toThrow()
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

describe('standalone payment bodies', () => {
  const receipt = { payment_type: 'inbound', partner_id: 7, amount: 500, payment_date: '2026-10-19', journal_id: 6 }

  it('accepts a receipt, a draft edit and an allocation', () => {
    expect(FinancePaymentStandaloneSchema.parse(receipt)).toEqual(receipt)
    expect(FinancePaymentPatchSchema.parse({ amount: 450 })).toEqual({ amount: 450 })
    expect(FinancePaymentAllocateSchema.parse({ invoice_ids: [3] })).toEqual({ invoice_ids: [3] })
    expect(FinancePaymentAllocateSchema.parse({ payment_ids: [9] })).toEqual({ payment_ids: [9] })
  })

  it('refuses unknown keys, an empty edit and an ambiguous allocation', () => {
    expect(() => FinancePaymentStandaloneSchema.parse({ ...receipt, invoice_ids: [1] })).toThrow()
    expect(() => FinancePaymentPatchSchema.parse({})).toThrow()
    expect(() => FinancePaymentPatchSchema.parse({ partner_id: 1 })).toThrow()
    expect(() => FinancePaymentAllocateSchema.parse({})).toThrow()
    expect(() => FinancePaymentAllocateSchema.parse({ invoice_ids: [1], payment_ids: [2] })).toThrow()
  })
})

describe('bank statement import bodies', () => {
  const file = { journal_id: 3, content: 'Date,Description,Amount\n2026-10-25,Deposit,100\n' }
  const mapping = { date: 'Date', payment_ref: 'Description', amount: 'Amount' }

  it('accepts the column proposal request, the mapped preview and the import', () => {
    expect(FinanceBankImportPreviewRequestSchema.parse(file)).toEqual(file)
    expect(FinanceBankImportPreviewRequestSchema.parse({ ...file, mapping })).toEqual({ ...file, mapping })
    const body = { ...file, mapping, balance_start: 0, balance_end_real: 100 }
    expect(FinanceBankImportSchema.parse(body)).toEqual(body)
  })

  it('refuses an import with no balances, a missing mapping or an unknown key', () => {
    expect(() => FinanceBankImportSchema.parse({ ...file, mapping })).toThrow()
    expect(() => FinanceBankImportSchema.parse({ ...file, balance_start: 0, balance_end_real: 0 })).toThrow()
    expect(() => FinanceBankImportSchema.parse({ ...file, mapping, balance_start: 0, balance_end_real: 0, colour: 1 })).toThrow()
  })
})

describe('cash flow statement', () => {
  const statement = {
    date_from: '2026-01-01', date_to: '2026-12-31', currency: 'SAR', basis: 'indirect', statutory: false,
    opening_cash: 5000, closing_cash: 103000, net_change: 98000,
    operating: { net_income: 0, adjustments: [], items: [], total: 0 },
    investing: { items: [{ account: { id: 1, code: '106002', name: 'Furniture' }, amount: -12000 }], depreciation_reclass: 0, total: -12000 },
    financing: { items: [], total: 110000 },
    total_change: 98000, difference: 0,
  }

  it('accepts a closed statement and refuses a statutory claim or an unknown key', () => {
    expect(FinanceCashFlowSchema.parse(statement)).toEqual(statement)
    expect(() => FinanceCashFlowSchema.parse({ ...statement, statutory: true })).toThrow()
    expect(() => FinanceCashFlowSchema.parse({ ...statement, extra: 1 })).toThrow()
  })
})

describe('VAT return', () => {
  const box = (number: number, base: number | null, tax: number | null) => ({ code: `sa_${number}`, number, name: `${number}. Box`, base, tax })

  it('accepts the boxes of a draft and refuses a filed or unknown shape', () => {
    const report = { date_from: '2026-10-01', date_to: '2026-10-31', currency: 'SAR', status: 'draft_for_review', filed: false, boxes: [box(1, 1000, 150), box(13, null, 150)] }
    expect(FinanceVatReturnSchema.parse(report)).toEqual(report)
    expect(() => FinanceVatReturnSchema.parse({ ...report, filed: true })).toThrow()
    expect(() => FinanceVatReturnSchema.parse({ ...report, boxes: [box(17, 1, 1)] })).toThrow()
    expect(() => FinanceVatReturnSchema.parse({ ...report, extra: 1 })).toThrow()
  })
})
