import { describe, expect, it } from 'vitest'
import { MeetingDetailSchema, MeetingListSchema } from '..'

const ITEM = {
  id: 1,
  name: 'مراجعة تشغيلية',
  reference: 'MM/0001',
  meeting_date: '2026-09-07',
  state: 'draft' as const,
  organizer: { id: 2, name: 'Admin' },
}

describe('meeting contracts', () => {
  it('parses list and detail envelopes', () => {
    expect(MeetingListSchema.parse({ items: [ITEM], total: 1 }).total).toBe(1)
    expect(MeetingDetailSchema.parse({
      ...ITEM,
      agenda: '<p>أ</p>',
      minutes: '',
      location: 'قاعة 1',
      start_datetime: null,
      end_datetime: null,
      meeting_url: '',
      can_edit: true,
      secretary: null,
      attendees: [{ id: 3, name: 'Sara' }],
      resolutions: [],
    }).attendees).toHaveLength(1)
  })
})
