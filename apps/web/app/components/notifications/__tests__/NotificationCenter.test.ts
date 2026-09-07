import { describe, expect, it } from 'vitest'
import { NotificationSchema } from '@nasq/contracts'
import { isDigestNotification, isMeetingNotification } from '../../../composables/useNotifications'

function href(item: ReturnType<typeof NotificationSchema.parse>) {
  if (isDigestNotification(item)) return `/notification-digests/${item.digest_id}`
  if (isMeetingNotification(item)) return `/meetings/${item.meeting_id}`
  return `/tasks/${item.task_id}`
}

describe('NotificationCenter digest routing', () => {
  it('routes meeting invitations to the meeting without inventing a task id', () => {
    const meeting = NotificationSchema.parse({
      id: 91, kind: 'meeting_invite', meeting_id: 7, meeting_name: 'Review', body: '',
      created_at: '2026-09-07T12:00:00Z', is_read: false,
    })
    expect(href(meeting)).toBe('/meetings/7')
    expect('task_id' in meeting).toBe(false)
  })
  it('keeps ordinary task notifications on the task route in ar and en fixtures', () => {
    const comment = NotificationSchema.parse({
      id: 11, kind: 'comment', task_id: 44, task_name: 'مهمة', body: 'تعليق',
      created_at: '2026-09-06T12:00:00Z', is_read: false,
    })
    const assignment = NotificationSchema.parse({
      id: 12, kind: 'assignment', task_id: 45, task_name: 'Assigned task', body: '',
      created_at: '2026-09-06T12:00:00Z', is_read: true,
    })
    expect(href(comment)).toBe('/tasks/44')
    expect(href(assignment)).toBe('/tasks/45')
    expect(isDigestNotification(comment)).toBe(false)
  })

  it('routes overdue digests to the digest page without inventing a task id', () => {
    const digest = NotificationSchema.parse({
      id: 90, kind: 'overdue_digest', digest_id: 90, overdue_count: 3,
      local_date: '2026-09-06', body: '3 overdue tasks',
      created_at: '2026-09-06T12:00:00Z', is_read: false,
    })
    expect(isDigestNotification(digest)).toBe(true)
    expect(href(digest)).toBe('/notification-digests/90')
    expect('task_id' in digest).toBe(false)
  })
})
