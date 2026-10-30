import { describe, expect, it } from 'vitest'
import type { FinanceCashFlow } from '@liwan/contracts'
import { cashFlowRows, vatReturnCells } from '../reportRows'

const report: FinanceCashFlow = {
  date_from: '2026-10-01', date_to: '2026-10-31', currency: 'SAR', basis: 'indirect', statutory: false, opening_cash: 50000, closing_cash: 50975, net_change: 975,
  operating: { net_income: 4975, adjustments: [{ key: 'depreciation', amount: 400 }], items: [{ account: { id: 5, code: '1100', name: 'Receivables' }, amount: -4400 }], total: 975 },
  investing: { items: [], depreciation_reclass: 0, total: 0 }, financing: { items: [], total: 0 }, total_change: 975, difference: 0,
}

describe('cash flow rows', () => {
  it('lists net income, the adjustments and the account changes, then closes each activity with its subtotal', () => {
    const rows = cashFlowRows(report)
    expect(rows.map(row => row.key)).toEqual(['net-income', 'adjustment-depreciation', 'operating-5', 'operating', 'investing', 'financing', 'net-change', 'opening', 'closing'])
    expect(rows.find(row => row.key === 'operating-5')).toMatchObject({ label: '1100 Receivables', amount: -4400 })
    expect(rows.filter(row => row.kind === 'total').map(row => row.amount)).toEqual([975, 0, 0, 975, 50975])
  })

  it('shows the depreciation taken out of the asset changes only when there is some', () => {
    expect(cashFlowRows({ ...report, investing: { ...report.investing, depreciation_reclass: 400 } }).map(row => row.key)).toContain('reclass')
  })
})

describe('VAT return cells', () => {
  it('opens only the columns a box has', () => {
    expect(vatReturnCells({ code: 'sa_1', number: 1, name: 'x', base: 100, tax: 15 })).toEqual([{ code: 'sa_1', column: 'base', amount: 100 }, { code: 'sa_1', column: 'tax', amount: 15 }])
    expect(vatReturnCells({ code: 'sa_13', number: 13, name: 'x', base: null, tax: 150 })).toEqual([{ code: 'sa_13', column: 'tax', amount: 150 }])
  })
})
