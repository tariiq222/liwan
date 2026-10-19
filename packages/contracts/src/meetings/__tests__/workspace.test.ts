import { describe, expect, it } from 'vitest'
import { MeetingMinutesFormSchema, MeetingResolutionCreateSchema, MeetingVersionListSchema, MeetingEventListSchema } from '..'

const form = { opening: 'افتتاح', closing: '', chairperson: 'رئيس الاجتماع', approver_name: '', approver_title: '', topics: [{ key: 'topic-1', title: 'متابعة', discussion: 'نقاش', project_id: null, resolution_ids: [17] }] }
const snapshot = { captured_at: '2026-09-09T09:00:00Z', name: 'محضر', meeting_date: '2026-09-09', start_datetime: null, end_datetime: null, location: '', organizer: null, secretary: null, attendees: [], agenda: '<p>جدول سابق</p>', minutes: '', resolutions: [] }

describe('meeting workspace wire compatibility', () => {
  it('retains structured topic references and rejects client-injected backing data', () => {
    expect(MeetingMinutesFormSchema.parse(form)).toEqual(form)
    expect(MeetingMinutesFormSchema.safeParse({ ...form, snapshot: {} }).success).toBe(false)
    expect(MeetingMinutesFormSchema.safeParse({ ...form, topics: [{ ...form.topics[0], project_id: -2 }] }).success).toBe(false)
  })
  it('accepts a meaningful execution period without inventing a deadline', () => {
    const recommendation = { name: 'متابعة مستمرة', responsible_id: 3, execution_period: 'مستمر', deadline: null }
    expect(MeetingResolutionCreateSchema.parse(recommendation)).toEqual(recommendation)
    expect(MeetingResolutionCreateSchema.safeParse({ ...recommendation, execution_period: '  ' }).success).toBe(false)
    expect(MeetingResolutionCreateSchema.safeParse({ name: 'متابعة', responsible_id: 3, deadline: '2026-09-10' }).success).toBe(true)
  })
  it('keeps legacy and structured finalized versions in the same envelope', () => {
    const version = { id: 1, number: 1, captured_at: snapshot.captured_at, actor: null, snapshot }
    const parsed = MeetingVersionListSchema.parse({ items: [version, { ...version, id: 2, number: 2, snapshot: { ...snapshot, minutes_form: form } }], total: 2 })
    const legacySnapshot = parsed.items[0]?.snapshot
    const structuredSnapshot = parsed.items[1]?.snapshot
    expect(legacySnapshot).toBeTruthy()
    expect(structuredSnapshot).toBeTruthy()
    expect(legacySnapshot?.minutes_form).toBeUndefined()
    expect(structuredSnapshot?.minutes_form?.topics[0]?.resolution_ids).toEqual([17])
    const stripped = MeetingVersionListSchema.parse({ items: [{ ...version, snapshot: { ...snapshot, raw_task_id: 9 } }], total: 1 })
    expect(stripped.items[0]?.snapshot).not.toHaveProperty('raw_task_id')
  })
  it('accepts a version whose snapshot is missing or undated', () => {
    const version = { id: 3, number: 3, captured_at: snapshot.captured_at, actor: null, snapshot: null }
    expect(MeetingVersionListSchema.parse({ items: [version], total: 1 }).items[0]?.snapshot).toBeNull()
    const undated = { ...version, snapshot: { ...snapshot, captured_at: null } }
    expect(MeetingVersionListSchema.parse({ items: [undated], total: 1 }).items[0]?.snapshot?.captured_at).toBeNull()
  })
  it('supports an empty activity history without fabricated entries', () => {
    expect(MeetingEventListSchema.parse({ items: [], total: 0 })).toEqual({ items: [], total: 0 })
  })
})
