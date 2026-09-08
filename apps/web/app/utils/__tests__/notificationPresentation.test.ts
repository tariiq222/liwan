import { describe, expect, it } from 'vitest'
import {
  formatNotificationTimestamp,
  notificationPreviewCaptionKey,
  parseNotificationDate,
} from '../notificationPresentation'

describe('notification presentation', () => {
  it('parses an ISO timestamp as the UTC instant it represents', () => {
    expect(parseNotificationDate('2026-09-07T21:28:05Z')?.toISOString()).toBe('2026-09-07T21:28:05.000Z')
  })

  it('interprets an Odoo naive datetime as UTC', () => {
    expect(parseNotificationDate('2026-09-07 21:28:05')?.toISOString()).toBe('2026-09-07T21:28:05.000Z')
  })

  it('formats the instant in the requested locale and user timezone', () => {
    expect(formatNotificationTimestamp('2026-09-07T21:28:05Z', 'en-US', 'Asia/Riyadh')).toEqual({
      datetime: '2026-09-07T21:28:05.000Z',
      label: 'Sep 8, 2026, 12:28 AM',
    })
  })

  it('uses the Gregorian calendar for Arabic output', () => {
    const result = formatNotificationTimestamp('2026-09-07T21:28:05Z', 'ar', 'Asia/Riyadh')
    expect(result?.datetime).toBe('2026-09-07T21:28:05.000Z')
    expect(result?.label).toMatch(/2026|٢٠٢٦/)
    expect(result?.label).not.toContain('١٤٤٨')
  })

  it('omits malformed timestamps instead of showing raw input or throwing', () => {
    expect(parseNotificationDate('2026-02-30T21:28:05Z')).toBeNull()
    expect(formatNotificationTimestamp('not-a-date', 'en-US', 'Not/AZone')).toBeNull()
  })

  it('uses preview captions that do not interpolate the repeated record title', () => {
    expect(notificationPreviewCaptionKey('assignment')).toBe('notifications.preview.assignment')
    expect(notificationPreviewCaptionKey('comment')).toBe('notifications.preview.comment')
    expect(notificationPreviewCaptionKey('deadline')).toBe('notifications.preview.deadline')
    expect(notificationPreviewCaptionKey('meeting_invite')).toBe('meetingsUi.notify.meeting_invite')
    expect(notificationPreviewCaptionKey('overdue_digest')).toBe('tasks.digest.kind')
  })
})
