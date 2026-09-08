import { describe, expect, it } from 'vitest'
import { MeetingDetailSchema, MeetingListSchema } from '..'

const ITEM = {
  id: 1,
  name: 'مراجعة تشغيلية',
  reference: 'MM/0001',
  meeting_date: '2026-09-07',
  start_datetime: null,
  end_datetime: null,
  state: 'draft' as const,
  organizer: { id: 2, name: 'Admin' },
  open_resolution_count: 0,
  series_id: null,
  project_id: null,
}

describe('meeting contracts', () => {
  it('parses list and detail envelopes', () => {
    expect(MeetingListSchema.parse({ items: [ITEM], total: 1 }).total).toBe(1)
    expect(MeetingDetailSchema.parse({
      ...ITEM,
      agenda: '<p>أ</p>',
      minutes: '',
      location: 'قاعة 1',
      meeting_url: '',
      can_edit: true,
      can_manage: false,
      secretary: null,
      attendees: [{ id: 3, name: 'Sara' }],
      resolutions: [],
      series: null,
      project: null,
      previous_resolutions: [],
    }).attendees).toHaveLength(1)
  })
})
