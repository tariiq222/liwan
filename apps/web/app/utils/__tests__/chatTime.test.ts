import { describe, expect, it } from 'vitest'
import { chatListTime } from '../chatTime'

const now = new Date(2026, 9, 27, 15, 0)
const opts = { now, locale: 'en', yesterday: 'Yesterday' }
const at = (day: number, hour = 9, minute = 5) => new Date(2026, 9, day, hour, minute).toISOString()

describe('chatListTime', () => {
  it('shows the time for today', () => expect(chatListTime(at(27), opts)).toContain('09:05'))
  it('names yesterday, also across midnight', () => {
    expect(chatListTime(at(26, 23, 59), opts)).toBe('Yesterday')
    expect(chatListTime(new Date(2026, 9, 26, 0, 1).toISOString(), opts)).toBe('Yesterday')
  })
  it('shows the weekday within the last week', () => {
    expect(chatListTime(at(25), opts)).toBe('Sunday')
    expect(chatListTime(at(21), { ...opts, locale: 'ar' })).toMatch(/^[؀-ۿ\s]+$/)
  })
  it('shows the date from a week back', () => expect(chatListTime(at(20), opts)).toContain('20/10/2026'))
  it('returns an empty label for a missing or invalid value', () => {
    expect(chatListTime(null, opts)).toBe('')
    expect(chatListTime('not a date', opts)).toBe('')
  })
})
