import { describe, expect, it } from 'vitest'
import { assetDuration, assetMethodSummary } from '../assetMethod'

const t = (key: string, params?: Record<string, unknown>, count?: number) => `${key}${params ? JSON.stringify(params) : ''}${count === undefined ? '' : `#${count}`}`

describe('asset method text', () => {
  const source = { method: 'linear', method_time: 'year', method_number: 3, method_period: 'month' } as const

  it('counts the duration in years or in depreciations by the method time', () => {
    expect(assetDuration(source, t)).toBe('financeAssets.duration.year{"count":3}#3')
    expect(assetDuration({ ...source, method_time: 'number', method_number: 36 }, t)).toBe('financeAssets.duration.number{"count":36}#36')
  })

  it('joins the method, the duration and the period', () => {
    expect(assetMethodSummary(source, t).split(' · ')).toEqual(['financeAssets.methods.linear', 'financeAssets.duration.year{"count":3}#3', 'financeAssets.periods.month'])
  })
})
