import { describe, expect, it } from 'vitest'
import { bankErrorKey } from '../bankErrors'
import { hasEndDifference, lineState, reconcilePath, roundMoney, sameMoney, statementPath, statementSummary } from '../bankModel'

const line = (id: number, amount: number, reconciled: boolean) => ({ id, date: '2026-09-01', payment_ref: 'x', partner: null, amount, is_reconciled: reconciled, amount_residual: reconciled ? 0 : amount })

describe('bank money', () => {
  it('compares to the cent', () => {
    expect(sameMoney(0.1 + 0.2, 0.3)).toBe(true)
    expect(sameMoney(10, 10.01)).toBe(false)
    expect(roundMoney(-0.001)).toBe(0)
    expect(hasEndDifference({ balance_end: 100, balance_end_real: 100 })).toBe(false)
    expect(hasEndDifference({ balance_end: 100, balance_end_real: 130 })).toBe(true)
  })
})

describe('bank routes', () => {
  it('addresses the statement and the line of a statement', () => {
    expect(statementPath(4)).toBe('/finance/bank/statements/4')
    expect(reconcilePath(4, 12)).toBe('/finance/bank/statements/4/lines/12')
  })
})

describe('the statement summary', () => {
  it('counts and sums the reconciled and the open lines from the statement itself', () => {
    const summary = statementSummary({ lines: [line(1, 100.1, true), line(2, 50.2, true), line(3, -30, false), line(4, 5, false)] })
    expect(summary).toEqual({ reconciledCount: 2, openCount: 2, reconciledAmount: 150.3, openAmount: -25, fullyReconciled: false })
    expect(lineState(line(3, 1, false))).toBe('open')
  })

  it('is fully reconciled only with lines and none open', () => {
    expect(statementSummary({ lines: [line(1, 10, true)] }).fullyReconciled).toBe(true)
    expect(statementSummary({ lines: [] }).fullyReconciled).toBe(false)
  })
})

describe('bank error codes', () => {
  it('explains the reconciliation refusals and leaves the rest to the server message', () => {
    expect(bankErrorKey('not_balanced')).toBe('financeBank.errors.notBalanced')
    expect(bankErrorKey('invalid_state')).toBe('financeBank.errors.invalidState')
    expect(bankErrorKey('boom')).toBeNull()
  })
})
