import { describe, expect, it } from 'vitest'
import { priorityTone, riskScoreTone, STATUS_COLOR } from '../statusTone'

describe('statusTone', () => {
  it('maps every tone to a semantic color for Nuxt UI badges', () => {
    expect(STATUS_COLOR.success).toBe('success')
    expect(STATUS_COLOR.warning).toBe('warning')
    expect(STATUS_COLOR.info).toBe('info')
    expect(STATUS_COLOR.destructive).toBe('error')
    expect(STATUS_COLOR.neutral).toBe('neutral')
    expect(STATUS_COLOR.primary).toBe('primary')
  })

  it.each([
    [null, 'neutral'], [0, 'neutral'], [1, 'info'], [6, 'info'], [7, 'warning'], [12, 'warning'], [13, 'destructive'], [25, 'destructive'],
  ] as const)('a risk score of %s is %s', (score, tone) => {
    expect(riskScoreTone(score)).toBe(tone)
  })

  it.each([
    ['0', 'neutral'], ['normal', 'neutral'], [null, 'neutral'], ['1', 'warning'], ['2', 'warning'], ['high', 'warning'], ['3', 'destructive'], ['urgent', 'destructive'], [3, 'destructive'],
  ] as const)('priority %s is %s', (priority, tone) => {
    expect(priorityTone(priority)).toBe(tone)
  })
})
