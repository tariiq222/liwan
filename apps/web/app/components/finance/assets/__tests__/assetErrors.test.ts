import { describe, expect, it } from 'vitest'
import { assetErrorKey } from '../assetErrors'

describe('asset errors', () => {
  it('maps the known codes to the assets messages', () => {
    expect(assetErrorKey('not_draft')).toBe('financeAssets.errors.notDraft')
    expect(assetErrorKey('period_locked')).toBe('financeAssets.errors.periodLocked')
    expect(assetErrorKey('nope')).toBeNull()
  })
})
