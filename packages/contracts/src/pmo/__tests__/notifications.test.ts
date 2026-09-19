import { describe, expect, it } from 'vitest'
import {
  NotificationListSchema,
  NotificationReadResultSchema,
  NotificationSchema,
} from '../notification'

describe('notification contracts', () => {
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
})

