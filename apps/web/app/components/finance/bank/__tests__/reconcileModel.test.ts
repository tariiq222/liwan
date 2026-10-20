import { describe, expect, it } from 'vitest'
import { buildReconcileBody, canWriteOffTo, remainingDifference, selectedTotal } from '../reconcileModel'

const proposals = [{ id: 1, amount_residual: 100.1 }, { id: 2, amount_residual: 50.2 }, { id: 3, amount_residual: 10 }]

describe('the selection of open items', () => {
  it('totals the ticked items to the cent', () => {
    expect(selectedTotal(proposals, [])).toBe(0)
    expect(selectedTotal(proposals, [1, 2])).toBe(150.3)
    expect(selectedTotal(proposals, [3, 99])).toBe(10)
  })

  it('leaves the line residual less the selection', () => {
    expect(remainingDifference(150.3, selectedTotal(proposals, [1, 2]))).toBe(0)
    expect(remainingDifference(-200, -150)).toBe(-50)
    expect(remainingDifference(100, 110)).toBe(-10)
  })
})

describe('the write-off account', () => {
  it('refuses the types the server refuses', () => {
    for (const account_type of ['asset_receivable', 'liability_payable', 'asset_cash', 'liability_credit_card'] as const) expect(canWriteOffTo({ account_type })).toBe(false)
    for (const account_type of ['expense', 'income', 'asset_current'] as const) expect(canWriteOffTo({ account_type })).toBe(true)
  })
})

describe('the reconcile body', () => {
  const none = { accountId: null, label: '' }

  it('sends only the items when nothing remains, even if an account was picked', () => {
    expect(buildReconcileBody([1, 2], 0, { accountId: 9, label: 'x' })).toEqual({ move_line_ids: [1, 2] })
  })

  it('adds the account and its label while a difference remains', () => {
    expect(buildReconcileBody([1], 5, { accountId: 9, label: ' فرق عملة ' })).toEqual({ move_line_ids: [1], account_id: 9, label: 'فرق عملة' })
    expect(buildReconcileBody([1], 5, { accountId: 9, label: ' ' })).toEqual({ move_line_ids: [1], account_id: 9 })
    expect(buildReconcileBody([], 40, { accountId: 9, label: '' })).toEqual({ account_id: 9 })
  })

  it('refuses a difference without an account and an empty choice', () => {
    expect(buildReconcileBody([1], 5, none)).toBeNull()
    expect(buildReconcileBody([], 0, none)).toBeNull()
  })

  it('treats a sub-cent difference as cleared', () => {
    expect(buildReconcileBody([1], 0.004, none)).toEqual({ move_line_ids: [1] })
  })
})
