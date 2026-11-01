import { describe, expect, it } from 'vitest'
import { EvmProgressMethodSchema, ProjectEvmSchema } from '../evm'

const evm = {
  project_id: 2, baseline_number: 1, computed_at: '2026-03-15T09:00:00Z', as_of: '2026-03-15',
  currency: { id: 1, name: 'SAR', symbol: 'ر.س', decimal_places: 2 }, method: 'manual', hidden_count: 0, undated_count: 0,
  bac: 120000, pv: 60000, ev: 42000, ac: 48000, sv: -18000, cv: -6000, spi: 0.7, cpi: 0.88, eac: 137142.86, etc: 89142.86, vac: -17142.86, tcpi: 1.08,
  planned_curve: [{ date: '2026-03-01', pv: 0 }, { date: '2026-03-30', pv: 120000 }],
}

describe('earned value contract', () => {
  it('round trips the worked example', () => {
    expect(ProjectEvmSchema.parse(evm)).toEqual(evm)
  })

  it('accepts null indices where a divisor is not positive and an empty curve', () => {
    const empty = { ...evm, bac: 0, pv: 0, ev: 0, sv: 0, cv: null, spi: null, cpi: null, eac: null, etc: null, vac: null, tcpi: null, planned_curve: [] }
    expect(ProjectEvmSchema.safeParse(empty).success).toBe(true)
  })

  it('stays strict', () => {
    expect(ProjectEvmSchema.safeParse({ ...evm, extra: 1 }).success).toBe(false)
    expect(ProjectEvmSchema.safeParse({ ...evm, method: 'guess' }).success).toBe(false)
    expect(ProjectEvmSchema.safeParse({ ...evm, as_of: '2026-02-30' }).success).toBe(false)
  })

  it('knows the two progress methods only', () => {
    expect(EvmProgressMethodSchema.options).toEqual(['binary', 'manual'])
  })
})
