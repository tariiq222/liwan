import { describe, expect, it } from 'vitest'
import {
  NotificationKindSchema,
  NotificationListSchema,
  NotificationReadResultSchema,
  NotificationSchema,
  ProjectNotificationKindSchema,
  UnknownNotificationSchema,
} from '../notification'

describe('notification contracts', () => {
  it('accepts the charter bell rows and rejects task keys on them', () => {
    const row = {
      id: 11, kind: 'charter_review', project_id: 4, project_name: 'Erada Portal',
      body: 'Mona asked you to review the charter', created_at: '2026-10-15T10:00:00Z', is_read: false,
    }
    for (const kind of ['charter_review', 'charter_approved', 'charter_returned'] as const) {
      expect(NotificationSchema.parse({ ...row, kind }).kind).toBe(kind)
      expect(ProjectNotificationKindSchema.parse(kind)).toBe(kind)
      expect(NotificationKindSchema.parse(kind)).toBe(kind)
    }
    expect(NotificationListSchema.parse({ items: [row], total: 1, unread_count: 1 }).items).toEqual([row])
    expect(() => NotificationSchema.parse({ ...row, task_id: 2 })).toThrow()
    expect(() => NotificationSchema.parse({ ...row, project_id: undefined })).toThrow()
  })

  it('accepts the completion bell rows as task rows', () => {
    const row = {
      id: 12, task_id: 3, task_name: 'Write brief', body: 'Mona asked for completion of Write brief',
      created_at: '2026-10-31T10:00:00Z', is_read: false,
    }
    for (const kind of ['completion_requested', 'completion_accepted'] as const) {
      expect(NotificationSchema.parse({ ...row, kind }).kind).toBe(kind)
      expect(NotificationKindSchema.parse(kind)).toBe(kind)
    }
    expect(() => NotificationSchema.parse({ ...row, kind: 'completion_requested', project_id: 4 })).toThrow()
  })

  it('accepts the list and read response wire shapes', () => {
    const notification = {
      id: 7, kind: 'comment', task_id: 12, task_name: 'Review brief',
      body: 'A comment was added', created_at: '2026-09-05T10:00:00Z', is_read: false,
    }
    expect(NotificationSchema.parse(notification)).toEqual(notification)
    expect(NotificationListSchema.parse({ items: [notification], total: 1, unread_count: 1 }).unread_count).toBe(1)
    expect(NotificationReadResultSchema.parse({ updated: 1 }).updated).toBe(1)
  })

  it('rejects unknown kinds and extra keys', () => {
    expect(NotificationSchema.parse({
      id: 8, kind: 'overdue_digest', digest_id: 8, overdue_count: 2, local_date: '2026-09-05',
      body: '2 overdue tasks', created_at: '2026-09-05T10:00:00Z', is_read: true,
    }).kind).toBe('overdue_digest')
    expect(NotificationSchema.parse({
      id: 1, kind: 'mention', task_id: 2, task_name: 'x', body: '@Nora look',
      created_at: '2026-09-05T10:00:00Z', is_read: false,
    }).kind).toBe('mention')
    expect(() => NotificationSchema.parse({
      id: 1, kind: 'reaction', task_id: 2, task_name: 'x', body: 'x',
      created_at: '2026-09-05T10:00:00Z', is_read: false,
    })).toThrow()
    expect(() => NotificationReadResultSchema.parse({ updated: 1, ignored: true })).toThrow()
  })

  it("lists a newer application's kind as a generic row and keeps known kinds strict", () => {
    const known = {
      id: 7, kind: 'comment', task_id: 12, task_name: 'Review brief',
      body: 'A comment was added', created_at: '2026-09-05T10:00:00Z', is_read: false,
    }
    const unknown = {
      id: 9, kind: 'sales_order_assigned', order_id: 5, title: 'SO-0005',
      body: 'Order assigned to you', created_at: '2026-10-07T09:00:00Z', is_read: false,
    }
    const list = NotificationListSchema.parse({ items: [unknown, known], total: 2, unread_count: 2 })
    expect(list.items).toEqual([unknown, known])
    expect(UnknownNotificationSchema.parse({ id: 10, kind: 'sales_quote_expired', created_at: '2026-10-07T09:00:00Z', is_read: true }))
      .toEqual({ id: 10, kind: 'sales_quote_expired', created_at: '2026-10-07T09:00:00Z', is_read: true })
    // An application's dotted kind (the inbox assignment) parses as a generic row and does not fail the list.
    const dotted = { id: 11, kind: 'inbox.assigned', conversation_id: 3, title: 'Sara', body: '', created_at: '2026-10-29T09:00:00Z', is_read: false }
    expect(NotificationListSchema.parse({ items: [dotted], total: 1, unread_count: 1 }).items).toEqual([dotted])
    expect(NotificationSchema.safeParse(unknown).success).toBe(false)
    // A known kind never falls back to the generic row: a malformed known row still fails the list.
    const { task_id: _taskId, ...withoutTask } = known
    for (const bad of [{ ...known, extra: true }, withoutTask, { ...known, kind: 'meeting_invite' }]) {
      expect(() => NotificationListSchema.parse({ items: [bad], total: 1, unread_count: 1 })).toThrow()
    }
    for (const bad of [
      { ...unknown, kind: 'Sales-Order' },
      { ...unknown, id: 0 },
      { ...unknown, is_read: undefined },
      { ...unknown, created_at: undefined },
    ]) {
      expect(() => NotificationListSchema.parse({ items: [bad], total: 1, unread_count: 1 })).toThrow()
    }
  })

  it('tolerates null title and body on a generic row only', () => {
    const generic = {
      id: 11, kind: 'sales_order_assigned', title: null, body: null,
      created_at: '2026-10-07T09:00:00Z', is_read: false,
    }
    expect(NotificationListSchema.parse({ items: [generic], total: 1, unread_count: 1 }).items).toEqual([generic])
    const known = {
      id: 1, kind: 'assignment', task_id: 3, task_name: 'T', body: 'x',
      created_at: '2026-10-07T09:00:00Z', is_read: false,
    }
    expect(() => NotificationListSchema.parse({ items: [{ ...known, body: null }], total: 1, unread_count: 1 })).toThrow()
  })
})
