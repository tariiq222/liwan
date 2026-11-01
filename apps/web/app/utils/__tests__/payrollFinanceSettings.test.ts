import { describe, expect, it } from 'vitest'
import type { HrPayrollFinanceSettings } from '@liwan/contracts'
import { NO_RECORD, accountChoicesFor, payrollFinanceDraft, payrollFinancePatch } from '../payrollFinanceSettings'

const accounts = Object.fromEntries(
  ['basic_expense', 'allowance_expense', 'variable_expense', 'gosi_expense', 'gosi_payable', 'salaries_payable', 'deduction', 'advance', 'eos_expense', 'eos_provision']
    .map((role, index) => [role, index === 0 ? { id: 11, name: 'رواتب' } : null]),
)
const settings = { journal: { id: 7, name: 'قيود' }, accounts, default_analytic_account: null, entry_detail: 'aggregated' } as HrPayrollFinanceSettings

describe('payrollFinancePatch', () => {
  it('is empty for an untouched draft', () => {
    expect(payrollFinancePatch(settings, payrollFinanceDraft(settings))).toEqual({})
  })

  it('names only the changed parts and sends null for a cleared reference', () => {
    const draft = payrollFinanceDraft(settings)
    draft.journal = NO_RECORD
    draft.entryDetail = 'per_employee'
    draft.accounts.basic_expense = '12'
    draft.accounts.advance = '30'
    expect(payrollFinancePatch(settings, draft)).toEqual({
      journal_id: null,
      entry_detail: 'per_employee',
      accounts: { basic_expense: 12, advance: 30 },
    })
  })
})

describe('accountChoicesFor', () => {
  const chart = [
    { id: 1, name: 'Receivable', code: '1101', reconcile: true },
    { id: 2, name: 'Current assets', code: '1010', reconcile: false },
    { id: 3, name: 'Lookup without the flag', code: '2000' },
  ]

  it('offers only reconcilable accounts for the roles settled by reconciliation', () => {
    expect(accountChoicesFor('salaries_payable', chart).map(account => account.id)).toEqual([1, 3])
    expect(accountChoicesFor('advance', chart).map(account => account.id)).toEqual([1, 3])
  })

  it('offers every account for the other roles', () => {
    expect(accountChoicesFor('basic_expense', chart)).toEqual(chart)
  })
})
