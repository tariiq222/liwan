import { describe, expect, it } from 'vitest'
import { resolveInlineDraft } from '../inlineEdit'

describe('resolveInlineDraft', () => {
  it('returns the trimmed draft when it differs from the saved value', () => {
    expect(resolveInlineDraft('  New name  ', 'Old name')).toBe('New name')
  })
  it('drops an unchanged draft, also when only the spacing differs', () => {
    expect(resolveInlineDraft('Same', 'Same')).toBeNull()
    expect(resolveInlineDraft(' Same ', 'Same')).toBeNull()
  })
  it('drops an empty draft unless empty is allowed', () => {
    expect(resolveInlineDraft('   ', 'Old')).toBeNull()
    expect(resolveInlineDraft('   ', 'Old', true)).toBe('')
    expect(resolveInlineDraft('', '', true)).toBeNull()
  })
})
