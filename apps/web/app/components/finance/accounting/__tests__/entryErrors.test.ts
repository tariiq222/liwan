import { describe, expect, it } from 'vitest'
import { entryErrorKey } from '../entryErrors'

describe('entry errors', () => {
  it('maps the known codes to the accounting messages', () => {
    expect(entryErrorKey('unbalanced')).toBe('financeAccounting.errors.unbalanced')
    expect(entryErrorKey('has_reconciliations')).toBe('financeAccounting.errors.hasReconciliations')
    expect(entryErrorKey('nope')).toBeNull()
  })
})
