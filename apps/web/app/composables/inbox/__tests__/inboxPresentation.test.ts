import { describe, expect, it } from 'vitest'
import { INBOX_PRIORITY_TONE, inboxDayKey, inboxFileKindKey, inboxListTime, inboxWaitingTime } from '../inboxPresentation'

describe('inbox presentation', () => {
  it('shows the clock for today and the date for an earlier day', () => {
    const now = new Date('2026-10-28T12:00:00Z')
    expect(inboxListTime('2026-10-28T09:30:00Z', 'en', now)).toMatch(/:/)
    expect(inboxListTime('2026-10-20T09:30:00Z', 'en', now)).not.toMatch(/:/)
    expect(inboxListTime(null, 'en', now)).toBe('')
  })

  it('shows a message from earlier today as a clock time, not a date', () => {
    const now = new Date('2026-10-28T20:00:00')
    expect(inboxListTime('2026-10-28T00:05:00', 'en', now)).toMatch(/:/)
    expect(inboxListTime('2026-10-27T23:55:00', 'en', now)).not.toMatch(/:/)
  })

  it('names the wait in minutes under an hour, hours under a day and days after', () => {
    const now = new Date('2026-10-28T12:00:00Z')
    expect(inboxWaitingTime('2026-10-28T11:45:00Z', 'en', now)).toMatch(/15 min/)
    expect(inboxWaitingTime('2026-10-28T09:00:00Z', 'en', now)).toMatch(/3 hr/)
    expect(inboxWaitingTime('2026-10-25T12:00:00Z', 'en', now)).toMatch(/3 days/)
    expect(inboxWaitingTime('2026-10-28T12:05:00Z', 'en', now)).not.toMatch(/-/)
  })

  it('groups messages by the calendar day of their timestamp', () => {
    expect(inboxDayKey('2026-10-28T23:59:59Z')).toBe('2026-10-28')
  })
})

describe('conversation list row', () => {
  it('names a file sent without a caption by its kind and leaves plain text to the preview', () => {
    expect(inboxFileKindKey('image')).toBe('inbox.kinds.image')
    expect(inboxFileKindKey('document')).toBe('inbox.kinds.document')
    expect(inboxFileKindKey('text')).toBeNull()
    expect(inboxFileKindKey(null)).toBeNull()
  })

  it('marks every priority but the default one', () => {
    expect(INBOX_PRIORITY_TONE).toEqual({ low: 'neutral', high: 'warning', urgent: 'destructive' })
    expect(INBOX_PRIORITY_TONE.normal).toBeUndefined()
  })
})
