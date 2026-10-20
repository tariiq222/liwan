import { describe, expect, it } from 'vitest'
import { ApiError } from '../../../composables/useApi'
import { financeErrorMessage } from '../financeErrors'

const t = (key: string, params?: Record<string, unknown>) => params ? `t:${key}:${JSON.stringify(params)}` : `t:${key}`
const keyOf = (code: string) => code === 'period_locked' ? 'finance.errors.periodLocked' : null

describe('finance error messages', () => {
  it('translates a known code, shows the server text otherwise, and a generic line for non-API failures', () => {
    expect(financeErrorMessage(new ApiError(422, 'period_locked', 'locked'), keyOf, t)).toBe('t:finance.errors.periodLocked')
    expect(financeErrorMessage(new ApiError(422, 'invalid', 'bad date'), keyOf, t)).toBe('bad date')
    expect(financeErrorMessage(new Error('x'), keyOf, t)).toBe('t:errors.generic')
  })

  it('fills the known message from the error', () => {
    const error = new ApiError(422, 'period_locked', 'locked', undefined, { day: '2026-01-01' })
    expect(financeErrorMessage(error, keyOf, t, cause => ({ day: cause.details?.day }))).toBe('t:finance.errors.periodLocked:{"day":"2026-01-01"}')
  })
})
