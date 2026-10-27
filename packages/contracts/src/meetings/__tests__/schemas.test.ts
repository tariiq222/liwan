import { describe, expect, it } from 'vitest'
import { MeetingCreateSchema, MeetingDetailSchema, MeetingListSchema, MeetingPatchSchema, MeetingResolutionSchema, MeetingSeriesCreateSchema, MeetingSeriesDetailSchema, MeetingSeriesListSchema } from '..'
import { NotificationSchema } from '../../pmo/notification'

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
  it('preserves explicit cleared series defaults when creating an occurrence', () => {
    expect(MeetingCreateSchema.parse({
      name: 'Occurrence', series_id: 1, attendee_ids: [], secretary_id: null,
      location: '', meeting_url: '',
    })).toEqual({
      name: 'Occurrence', series_id: 1, attendee_ids: [], secretary_id: null,
      location: '', meeting_url: '',
    })
  })

  it('accepts explicit nulls for clearing meeting schedule fields', () => {
    expect(MeetingPatchSchema.parse({ start_datetime: null, end_datetime: null })).toEqual({
      start_datetime: null,
      end_datetime: null,
    })
  })

  it('detaches from a series with a null series_id and carries the write_date of the edited copy', () => {
    expect(MeetingPatchSchema.parse({ series_id: null, write_date: '2026-09-07T10:00:00Z' })).toEqual({
      series_id: null,
      write_date: '2026-09-07T10:00:00Z',
    })
    expect(MeetingPatchSchema.safeParse({ write_date: 42 }).success).toBe(false)
    expect(MeetingDetailSchema.safeParse({ ...ITEM, agenda: '', minutes: '', location: '', meeting_url: '', can_edit: true, can_manage: false, secretary: null, attendees: [], resolutions: [], series: null, project: null, previous_resolutions: [] }).success).toBe(false)
  })

  it('accepts additive resolution execution fields from the server', () => {
    expect(MeetingResolutionSchema.parse({
      id: 4,
      name: 'Follow up',
      deadline: '2026-09-12',
      priority: '0',
      state: 'open',
      responsible: null,
      task_id: null,
      result: '',
      can_update_execution: true,
      can_edit_decision: true,
      execution_state: 'open',
      task_linked: false,
      allowed_actions: ['start', 'complete', 'cancel', 'edit_result'],
    }).execution_state).toBe('open')
  })
  it('parses list and detail envelopes', () => {
    expect(MeetingListSchema.parse({ items: [ITEM], total: 1 }).total).toBe(1)
    expect(MeetingDetailSchema.parse({
      ...ITEM,
      write_date: '2026-09-07T10:00:00Z',
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
      minutes_snapshot: null,
    }).attendees).toHaveLength(1)
  })

  it('strips unknown response keys but still rejects unknown request keys', () => {
    expect(MeetingListSchema.parse({ items: [{ ...ITEM, server_only: 1 }], total: 1 }).items[0]).not.toHaveProperty('server_only')
    expect(MeetingCreateSchema.safeParse({ name: 'Strict', server_only: 1 }).success).toBe(false)
    expect(MeetingPatchSchema.safeParse({ name: 'Strict', server_only: 1 }).success).toBe(false)
  })

  it('keeps minutes_snapshot additive for legacy detail payloads', () => {
    const legacy = {
      id: 1,
      name: 'Legacy',
      reference: 'MM/0002',
      meeting_date: null,
      start_datetime: null,
      end_datetime: null,
      state: 'done' as const,
      organizer: null,
      open_resolution_count: 0,
      series_id: null,
      project_id: null,
      write_date: '2026-09-07T10:00:00Z',
      agenda: '', minutes: '', location: '', meeting_url: '',
      can_edit: false, can_manage: false, secretary: null,
      attendees: [], resolutions: [], series: null, project: null,
      previous_resolutions: [],
    }
    expect(MeetingDetailSchema.parse(legacy).minutes_snapshot).toBeUndefined()
  })
})

describe('meeting series boundaries', () => {
  const recurring = {
    name: 'Weekly review', recurrence: 'weekly', until_count: 3,
    start_datetime: '2026-09-08T06:00:00Z', end_datetime: '2026-09-08T07:00:00Z',
  }

  it('allows on-demand creation without a schedule', () => {
    expect(MeetingSeriesCreateSchema.parse({ name: 'Committee' })).toEqual({ name: 'Committee' })
  })

  it.each(['weekly', 'biweekly', 'monthly'])('accepts %s with a bounded schedule', (recurrence) => {
    expect(MeetingSeriesCreateSchema.safeParse({ ...recurring, recurrence }).success).toBe(true)
  })

  it.each([0, -1, 61, 1.5])('rejects invalid occurrence count %s', (until_count) => {
    expect(MeetingSeriesCreateSchema.safeParse({ ...recurring, until_count }).success).toBe(false)
  })

  it('requires exactly one recurrence termination', () => {
    const { until_count: _, ...withoutCount } = recurring
    expect(MeetingSeriesCreateSchema.safeParse(withoutCount).success).toBe(false)
    expect(MeetingSeriesCreateSchema.safeParse({ ...recurring, until_date: '2026-10-01' }).success).toBe(false)
    expect(MeetingSeriesCreateSchema.safeParse({ ...withoutCount, until_date: '2026-10-01' }).success).toBe(true)
  })

  it.each(['start_datetime', 'end_datetime'])('requires %s for recurring series', (field) => {
    const body: Record<string, unknown> = { ...recurring }
    delete body[field]
    expect(MeetingSeriesCreateSchema.safeParse(body).success).toBe(false)
  })

  it('rejects malformed dates and unzoned times', () => {
    expect(MeetingSeriesCreateSchema.safeParse({ ...recurring, start_datetime: 'not-a-date' }).success).toBe(false)
    expect(MeetingSeriesCreateSchema.safeParse({ ...recurring, start_datetime: '2026-09-08T09:00' }).success).toBe(false)
    const { until_count: _, ...withoutCount } = recurring
    expect(MeetingSeriesCreateSchema.safeParse({ ...withoutCount, until_date: '2026-02-30' }).success).toBe(false)
  })

  it('rejects a nonpositive duration and an end date before the first occurrence', () => {
    expect(MeetingSeriesCreateSchema.safeParse({ ...recurring, end_datetime: recurring.start_datetime }).success).toBe(false)
    expect(MeetingSeriesCreateSchema.safeParse({ ...recurring, end_datetime: '2026-09-08T05:00:00Z' }).success).toBe(false)
    const { until_count: _, ...withoutCount } = recurring
    expect(MeetingSeriesCreateSchema.safeParse({ ...withoutCount, until_date: '2026-09-07' }).success).toBe(false)
  })

  it('parses nonempty series list and detail responses', () => {
    const row = {
      id: 1, name: 'Committee', recurrence: 'weekly', active: true, until_count: 3, until_date: null,
      organizer: { id: 2, name: 'Organizer' }, project: null,
      open_resolution_count: 2, overdue_resolution_count: 1,
    }
    expect(MeetingSeriesListSchema.parse({ items: [row], total: 51 }).total).toBe(51)
    expect(MeetingSeriesListSchema.parse({ items: [{ ...row, active: false }], total: 1 }).items[0]?.active).toBe(false)
    expect(MeetingSeriesDetailSchema.parse({
      ...row, location: 'Room', meeting_url: '', secretary: null,
      attendees: [{ id: 3, name: 'Member' }], meetings: [{ ...ITEM, series_id: 1 }], can_edit: true,
    }).meetings[0]?.series_id).toBe(1)
  })

  it.each(['meeting_changed', 'meeting_cancelled', 'meeting_reminder', 'meeting_resolution_overdue'])('accepts %s as a meeting notification', (kind) => {
    expect(NotificationSchema.parse({
      id: 1, kind, meeting_id: 1, meeting_name: 'Review', body: 'Notice',
      created_at: '2026-09-08T06:00:00Z', is_read: false,
    }).kind).toBe(kind)
  })
})
