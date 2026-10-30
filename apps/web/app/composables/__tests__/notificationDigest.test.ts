import { describe, expect, it } from 'vitest'
import { NotificationSchema } from '@liwan/contracts'

describe('notification digest client variant', () => {
  it('routes digest items away from task ids', () => {
    const digest = NotificationSchema.parse({
      id: 4, kind: 'overdue_digest', digest_id: 4, overdue_count: 3, local_date: '2026-09-06',
      body: '3 overdue tasks', created_at: '2026-09-06T09:00:00Z', is_read: false,
    })
    expect(digest.kind).toBe('overdue_digest')
    expect('task_id' in digest).toBe(false)
    const task = NotificationSchema.parse({
      id: 5, kind: 'deadline', task_id: 9, task_name: 'Due', body: 'due',
      created_at: '2026-09-06T09:00:00Z', is_read: false,
    })
    expect(task.kind).toBe('deadline')
  })
})
