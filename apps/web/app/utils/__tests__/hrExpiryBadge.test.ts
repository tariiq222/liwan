import { describe, expect, it } from 'vitest'
import { HR_EXPIRY_URGENT_DAYS, hrExpiryTone } from '../hrExpiryBadge'

describe('hrExpiryTone', () => {
  it('marks an overdue item destructive', () => {
    expect(hrExpiryTone(-1)).toBe('destructive')
    expect(hrExpiryTone(-90)).toBe('destructive')
  })

  it('marks an item due today or within the urgent window as a warning', () => {
    expect(hrExpiryTone(0)).toBe('warning')
    expect(hrExpiryTone(HR_EXPIRY_URGENT_DAYS)).toBe('warning')
  })

  it('leaves a later item informational', () => {
    expect(hrExpiryTone(HR_EXPIRY_URGENT_DAYS + 1)).toBe('info')
    expect(hrExpiryTone(90)).toBe('info')
  })
})
