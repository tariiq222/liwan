import { describe, expect, it } from 'vitest'
import { ApiError } from '../../../../composables/useApi'
import { entryErrorKey, entryErrorMessage } from '../entryErrors'

const t = (key: string) => `t:${key}`

describe('entry errors', () => {
  it('maps the known codes to the accounting messages', () => {
    expect(entryErrorKey('unbalanced')).toBe('financeAccounting.errors.unbalanced')
    expect(entryErrorKey('has_reconciliations')).toBe('financeAccounting.errors.hasReconciliations')
    expect(entryErrorKey('nope')).toBeNull()
  })

  it('translates a known code, shows the server text otherwise, and a generic line for non-API failures', () => {
    expect(entryErrorMessage(new ApiError(422, 'period_locked', 'locked'), t)).toBe('t:financeAccounting.errors.periodLocked')
    expect(entryErrorMessage(new ApiError(422, 'invalid', 'bad date'), t)).toBe('bad date')
    expect(entryErrorMessage(new Error('x'), t)).toBe('t:errors.generic')
  })
})
