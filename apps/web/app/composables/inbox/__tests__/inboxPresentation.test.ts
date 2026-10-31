import { describe, expect, it } from 'vitest'
import { INBOX_PRIORITY_TONE, inboxDayKey, inboxFileKindKey, inboxListTime } from '../inboxPresentation'

describe('inbox presentation', () => {
  it('shows the clock for today and the date for an earlier day', () => {
    const now = new Date('2026-10-28T12:00:00Z')
    expect(inboxListTime('2026-10-28T09:30:00Z', 'en', now)).toMatch(/:/)
    expect(inboxListTime('2026-10-20T09:30:00Z', 'en', now)).not.toMatch(/:/)
    expect(inboxListTime(null, 'en', now)).toBe('')
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
