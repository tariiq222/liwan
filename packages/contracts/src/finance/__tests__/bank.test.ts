import {
  FinanceBankReconcileSchema,
  FinanceBankStatementCreateSchema,
  FinanceBankStatementDetailSchema,
  FinanceBankStatementListSchema,
  FinanceReconcileProposalListSchema,
} from '..'

const REF = { id: 6, name: 'Bank' }
const LINE = {
  id: 11, date: '2026-10-25', payment_ref: 'INV/2026/00001', partner: { id: 5, name: 'Al Noor Trading' },
  amount: 750, is_reconciled: false, amount_residual: 750,
}
const STATEMENT = {
  id: 2, name: 'October', date: '2026-10-31', journal: REF, currency: 'SAR',
  balance_start: 0, balance_end: 750, balance_end_real: 750, lines_count: 1,
}

describe('finance bank schemas', () => {
  it('parse the list, the detail with its lines and the reconcile proposals, and are strict', () => {
    expect(FinanceBankStatementListSchema.parse({ items: [STATEMENT], total: 1 })).toEqual({ items: [STATEMENT], total: 1 })
    expect(() => FinanceBankStatementListSchema.parse({ items: [{ ...STATEMENT, lines: [] }], total: 1 })).toThrow()
    const detail = { ...STATEMENT, lines: [LINE] }
    expect(FinanceBankStatementDetailSchema.parse(detail)).toEqual(detail)
    expect(() => FinanceBankStatementDetailSchema.parse({ ...detail, lines: [{ ...LINE, is_reconciled: 'yes' }] })).toThrow()
    const proposal = {
      id: 40, date: '2026-10-18', entry: 'INV/2026/00001', label: 'INV/2026/00001', partner: LINE.partner,
      account: { id: 3, name: '102011 Accounts Receivable' }, amount_residual: 750, exact: true,
    }
    expect(FinanceReconcileProposalListSchema.parse({ items: [proposal], total: 1 })).toEqual({ items: [proposal], total: 1 })
    expect(() => FinanceReconcileProposalListSchema.parse({ items: [{ ...proposal, exact: 1 }], total: 1 })).toThrow()
  })

  it('accept a statement body and reject an empty or zero line, an unknown key and a string amount', () => {
    const line = { date: '2026-10-25', payment_ref: 'Deposit', amount: 50, partner_id: 5 }
    const body = { journal_id: 6, date: '2026-10-31', name: 'October', balance_start: 0, balance_end_real: 50, lines: [line] }
    expect(FinanceBankStatementCreateSchema.parse(body)).toEqual(body)
    expect(() => FinanceBankStatementCreateSchema.parse({ ...body, lines: [] })).toThrow()
    expect(() => FinanceBankStatementCreateSchema.parse({ ...body, lines: [{ ...line, amount: 0 }] })).toThrow()
    expect(() => FinanceBankStatementCreateSchema.parse({ ...body, lines: [{ ...line, amount: '50' }] })).toThrow()
    expect(() => FinanceBankStatementCreateSchema.parse({ ...body, lines: [{ ...line, extra: 1 }] })).toThrow()
    expect(() => FinanceBankStatementCreateSchema.parse({ ...body, state: 'done' })).toThrow()
    expect(() => FinanceBankStatementCreateSchema.parse({ journal_id: 6, lines: [line] })).toThrow()
  })

  it('a reconcile body needs items or an account, with distinct ids', () => {
    expect(FinanceBankReconcileSchema.parse({ move_line_ids: [40] })).toEqual({ move_line_ids: [40] })
    expect(FinanceBankReconcileSchema.parse({ account_id: 9, label: 'Interest' })).toEqual({ account_id: 9, label: 'Interest' })
    expect(() => FinanceBankReconcileSchema.parse({})).toThrow()
    expect(() => FinanceBankReconcileSchema.parse({ move_line_ids: [] })).toThrow()
    expect(() => FinanceBankReconcileSchema.parse({ move_line_ids: [40, 40] })).toThrow()
    expect(() => FinanceBankReconcileSchema.parse({ move_line_ids: [40], extra: 1 })).toThrow()
    expect(() => FinanceBankReconcileSchema.parse({ move_line_ids: [40], label: 'x' })).toThrow()
  })
})
