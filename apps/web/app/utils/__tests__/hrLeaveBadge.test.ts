import { describe, expect, it } from 'vitest'
import { hrLeaveBadge } from '../hrLeaveBadge'

describe('hrLeaveBadge', () => {
  it.each([
    ['confirm', 'info'], ['validate1', 'info'], ['validate', 'success'], ['refuse', 'destructive'], ['cancel', 'neutral'],
  ] as const)('%s is %s with its own label', (state, tone) => {
    expect(hrLeaveBadge(state)).toEqual({ tone, labelKey: `hr.leave.state.${state}` })
  })
})
