import { describe, expect, it } from 'vitest'
import { kpiLink } from '../app/utils/kpiLink'

describe('kpiLink', () => {
  it('returns the bare path when filters are empty or all skipped', () => {
    expect(kpiLink('/meetings', {})).toBe('/meetings')
    expect(kpiLink('/meetings', { q: '', mine: false, state: undefined })).toBe('/meetings')
  })

  it('serializes true as 1, numbers as strings, skips false/undefined/empty, and preserves order', () => {
    expect(
      kpiLink('/meetings', {
        q: '',
        mine: true,
        state: 'draft',
        archived: false,
        project_id: 42,
        offset: 0,
        series_id: undefined,
      }),
    ).toBe('/meetings?mine=1&state=draft&project_id=42&offset=0')
  })
})
