import { describe, expect, it } from 'vitest'
import { NotificationKindSchema, NotificationListSchema, NotificationSchema } from '../notification'

describe('assigned task notification contract', () => {
  const assigned = {
    id: 21,
    kind: 'tasks.assigned',
    task_id: 8,
    title: 'Plan',
    task_name: 'Plan',
    created_at: '2026-10-22T09:00:00Z',
    is_read: false,
  }

  it('accepts the exact row emitted by the tasks bell producer as a known kind', () => {
    expect(NotificationKindSchema.parse('tasks.assigned')).toBe('tasks.assigned')
    expect(NotificationSchema.parse(assigned)).toEqual(assigned)
    expect(NotificationListSchema.parse({ items: [assigned], total: 1, unread_count: 1 }).items).toEqual([assigned])
  })

  it('keeps known rows strict and rejects invalid list envelopes and counts', () => {
    for (const malformed of [
      { ...assigned, task_id: 0 },
      { ...assigned, title: undefined },
      { ...assigned, unexpected: true },
      { ...assigned, kind: 'tasks.assigned', title: 'Plan', task_name: undefined },
    ]) {
      expect(() => NotificationListSchema.parse({ items: [malformed], total: 1, unread_count: 1 })).toThrow()
    }
    expect(() => NotificationListSchema.parse({ items: [assigned], total: -1, unread_count: 0 })).toThrow()
    expect(() => NotificationListSchema.parse({ items: [assigned], total: 1, unread_count: -1 })).toThrow()
    expect(() => NotificationListSchema.parse({ items: [assigned], total: 1, unread_count: 0, extra: true })).toThrow()
  })

  it('continues to accept valid legacy underscore kinds as generic rows', () => {
    const legacy = {
      id: 22,
      kind: 'sales_order_assigned',
      created_at: '2026-10-22T09:00:00Z',
      is_read: true,
    }
    expect(NotificationListSchema.parse({ items: [legacy], total: 1, unread_count: 0 }).items).toEqual([legacy])
  })
})
