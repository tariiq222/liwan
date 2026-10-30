import { describe, expect, it } from 'vitest'
import { FinanceBudgetDistributeSchema } from '@liwan/contracts'
import { buildDistribute, emptyDistribute, evenPercents, hasDistributeErrors, percentTotal, shareAmount, validateDistribute } from '../budgetDistribute'

const valid = () => ({ ...emptyDistribute(), accountId: 7, amount: '1000', shares: [{ analyticId: 1, percent: '60' }, { analyticId: 2, percent: '40' }] })

describe('budget split between cost centers', () => {
  it('needs an account, an amount and two different cost centers whose percents add up to 100', () => {
    expect(hasDistributeErrors(validateDistribute(valid()))).toBe(false)
    expect(validateDistribute(emptyDistribute())).toMatchObject({ account: true, amount: true, shares: true })
    expect(validateDistribute({ ...valid(), shares: [{ analyticId: 1, percent: '60' }, { analyticId: 1, percent: '40' }] }).shares).toBe(true)
    expect(validateDistribute({ ...valid(), shares: [{ analyticId: 1, percent: '60' }, { analyticId: 2, percent: '30' }] })).toMatchObject({ total: true, shares: false })
    expect(validateDistribute({ ...valid(), shares: [{ analyticId: 1, percent: '100' }] }).shares).toBe(true)
    expect(validateDistribute({ ...valid(), dateFrom: '2026-02-01', dateTo: '2026-01-01' }).order).toBe(true)
  })

  it('splits evenly into whole cents of percent that add up to exactly 100', () => {
    for (const count of [2, 3, 7, 50]) expect(percentTotal(evenPercents(count).map(percent => ({ analyticId: null, percent })))).toBe(100)
    expect(evenPercents(3)).toEqual(['33.33', '33.33', '33.34'])
  })

  it('previews each share in money and builds a body the contract accepts', () => {
    expect(shareAmount('1000', '33.33')).toBe(333.3)
    expect(shareAmount('', '50')).toBeNull()
    expect(FinanceBudgetDistributeSchema.parse(buildDistribute({ ...valid(), label: ' Salaries ' }))).toEqual({
      account_id: 7, amount: 1000, label: 'Salaries', shares: [{ analytic_account_id: 1, percent: 60 }, { analytic_account_id: 2, percent: 40 }],
    })
  })
})
