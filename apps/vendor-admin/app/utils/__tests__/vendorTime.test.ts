import { describe, expect, it } from 'vitest'
import { formatBusinessDateTime } from '../vendorTime'

describe('formatBusinessDateTime', () => {
  it('shows an instant on the Riyadh clock whatever the browser zone is', () => {
    expect(formatBusinessDateTime('2026-11-22T22:30:00Z')).toContain('23/11/2026 01:30')
    expect(formatBusinessDateTime('2026-11-22T20:59:00Z')).toContain('22/11/2026 23:59')
  })
  it('is empty for an empty or invalid value', () => {
    expect(formatBusinessDateTime(null)).toBe('')
    expect(formatBusinessDateTime('not a date')).toBe('')
  })
})
