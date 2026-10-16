import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime, formatTime, isolateLtr } from '../formatDate'

const plain = (s: string) => s.replace(/[\u2066\u2069]/g, '')

describe('formatDate', () => {
  it('formats a calendar day as dd/MM/yyyy without shifting it', () => {
    expect(plain(formatDate('2035-12-31'))).toBe('31/12/2035')
    expect(plain(formatDate('2026-09-08'))).toBe('08/09/2026')
  })

  it('formats an instant in the given time zone', () => {
    expect(plain(formatDate('2026-09-15T23:30:00Z', 'UTC'))).toBe('15/09/2026')
    expect(plain(formatDate('2026-09-15T23:30:00Z', 'Asia/Riyadh'))).toBe('16/09/2026')
  })

  it('formats time as 24-hour HH:mm and datetime as dd/MM/yyyy HH:mm', () => {
    expect(plain(formatTime('2026-09-15T09:05:00Z', 'UTC'))).toBe('09:05')
    expect(plain(formatTime('2026-09-15T21:05:00Z', 'UTC'))).toBe('21:05')
    expect(plain(formatDateTime('2026-09-15T09:00:00Z', 'UTC'))).toBe('15/09/2026 09:00')
    expect(plain(formatDateTime('2026-09-15T00:00:00Z', 'UTC'))).toBe('15/09/2026 00:00')
  })

  it('wraps the result in a left-to-right isolate', () => {
    const out = formatDateTime('2026-09-15T09:00:00Z', 'UTC')
    expect(out.startsWith('\u2066')).toBe(true)
    expect(out.endsWith('\u2069')).toBe(true)
    expect(isolateLtr('')).toBe('')
  })

  it('returns an empty string for empty or invalid input', () => {
    expect(formatDate(null)).toBe('')
    expect(formatDate('')).toBe('')
    expect(formatDate('2030-02-30')).toBe('')
    expect(formatDateTime('not a date')).toBe('')
    expect(formatTime(undefined)).toBe('')
  })

  it('falls back to UTC for an unsupported time zone', () => {
    expect(plain(formatDateTime('2026-09-15T09:00:00Z', 'Not/AZone'))).toBe('15/09/2026 09:00')
  })
})
