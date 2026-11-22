import { describe, expect, it } from 'vitest'
import { BUSINESS_TIME_ZONE as CONTRACT_ZONE } from '@liwan/commercial-contracts'
import { BUSINESS_TIME_ZONE, formatBusinessDate, formatBusinessDateTime } from '../vendorTime'

describe('formatBusinessDate', () => {
  it('shows the Riyadh day of an instant and leaves a calendar day alone', () => {
    expect(formatBusinessDate('2026-11-22T22:30:00Z')).toContain('23/11/2026')
    expect(formatBusinessDate('2026-11-22')).toContain('22/11/2026')
    expect(formatBusinessDate(null)).toBe('')
  })
})
describe('the business zone', () => {
  it('is the one the commercial contracts define', () => {
    expect(BUSINESS_TIME_ZONE).toBe(CONTRACT_ZONE)
    expect(CONTRACT_ZONE).toBe('Asia/Riyadh')
  })
})
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
