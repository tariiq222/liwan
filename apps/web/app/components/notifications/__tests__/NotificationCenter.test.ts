import { describe, expect, it } from 'vitest'
import { NotificationListSchema, NotificationSchema, type BellNotification } from '@liwan/contracts'
import { isDigestNotification, isKnownNotification, isMeetingNotification, isProjectNotification } from '../../../composables/useNotifications'

// Mirrors notificationHref() in NotificationCenter.vue.
function href(item: BellNotification) {
  if (isDigestNotification(item)) return `/notification-digests/${item.digest_id}`
  if (isMeetingNotification(item)) return `/meetings/${item.meeting_id}`
  if (isProjectNotification(item)) return `/projects/${item.project_id}/charter`
  if (isKnownNotification(item)) return `/tasks/${item.task_id}`
  return null
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
  it('routes charter notifications to the project charter', () => {
    const charter = NotificationSchema.parse({
      id: 92, kind: 'charter_review', project_id: 12, project_name: 'Alpha', body: '',
      created_at: '2026-09-07T12:00:00Z', is_read: false,
    })
    expect(href(charter)).toBe('/projects/12/charter')
    expect('task_id' in charter).toBe(false)
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

  it("keeps a newer application's row as a generic row without a link", () => {
    const list = NotificationListSchema.parse({
      items: [
        { id: 93, kind: 'sales_order_assigned', order_id: 5, title: 'SO-0005', body: 'Order assigned to you', created_at: '2026-10-07T09:00:00Z', is_read: false },
        { id: 92, kind: 'meeting_future_change', body: 'Changed', created_at: '2026-10-07T09:00:00Z', is_read: true },
        { id: 91, kind: 'meeting_invite', meeting_id: 7, meeting_name: 'Review', body: '', created_at: '2026-09-07T12:00:00Z', is_read: false },
      ],
      total: 3,
      unread_count: 2,
    })
    const [sales, future, invite] = list.items as [BellNotification, BellNotification, BellNotification]
    expect(isKnownNotification(sales)).toBe(false)
    expect(href(sales)).toBeNull()
    // Not a meeting row: the old startsWith('meeting_') test would have linked /meetings/undefined.
    expect(isMeetingNotification(future)).toBe(false)
    expect(href(future)).toBeNull()
    expect(isKnownNotification(invite)).toBe(true)
    expect(href(invite)).toBe('/meetings/7')
  })
})
