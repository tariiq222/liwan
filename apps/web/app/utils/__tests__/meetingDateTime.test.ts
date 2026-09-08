import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fromUtcDateTimeInput, toUtcDateTime } from '../meetingDateTime'

describe('meeting datetime wire conversion', () => {
  const originalTimezone = process.env.TZ
  beforeAll(() => { process.env.TZ = 'Asia/Riyadh' })
  afterAll(() => {
    if (originalTimezone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimezone
  })

  it('serializes a datetime-local value as an ISO instant with the browser local offset', () => {
    expect(toUtcDateTime('2026-09-08T09:30')).toBe('2026-09-08T06:30:00.000Z')
    expect(toUtcDateTime('2026-09-07T23:30')).toBe('2026-09-07T20:30:00.000Z')
    expect(toUtcDateTime('2026-09-08T01:30')).toBe('2026-09-07T22:30:00.000Z')
  })

  it('converts a UTC response into the value expected by datetime-local', () => {
    const value = fromUtcDateTimeInput('2026-09-08T06:30:00.000Z')
    expect(value).toBe('2026-09-08T09:30')
    expect(fromUtcDateTimeInput('2026-09-08T00:30:00.000Z')).toBe('2026-09-08T03:30')
    expect(fromUtcDateTimeInput('2026-09-08T22:30:00.000Z')).toBe('2026-09-09T01:30')
  })

  it('keeps empty values optional', () => {
    expect(toUtcDateTime('')).toBeUndefined()
    expect(fromUtcDateTimeInput(null)).toBe('')
  })
})
