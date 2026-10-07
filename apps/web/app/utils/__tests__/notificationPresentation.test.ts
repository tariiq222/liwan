import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  formatNotificationTimestamp,
  genericNotificationText,
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
  it('preserves preview captions for the new meeting lifecycle notifications', () => {
    for (const kind of ['meeting_changed', 'meeting_cancelled', 'meeting_reminder', 'meeting_resolution_overdue'] as const) {
      expect(notificationPreviewCaptionKey(kind)).toBe(`meetingsUi.notify.${kind}`)
    }
  })

  it("captions a newer application's kind with a generic label present in both locales", () => {
    for (const kind of ['sales_order_assigned', 'meeting_future_change', 'reaction']) {
      expect(notificationPreviewCaptionKey(kind)).toBe('notifications.preview.other')
    }
    expect(notificationPreviewCaptionKey('mention')).toBe('notifications.preview.mention')
    for (const locale of ['ar', 'en']) {
      const messages = JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../i18n/locales/${locale}/notifications.json`), 'utf8'))
      expect(typeof messages.notifications.preview.other, locale).toBe('string')
      expect(messages.notifications.preview.other.length, locale).toBeGreaterThan(0)
    }
  })

  it('shows body as the secondary line of a generic row and the caption when it has no text', () => {
    expect(genericNotificationText({ title: 'SO-1', body: 'Assigned' })).toEqual({ title: 'SO-1', secondary: 'Assigned' })
    expect(genericNotificationText({ title: 'SO-1', body: '' })).toEqual({ title: 'SO-1', secondary: '' })
    expect(genericNotificationText({ body: 'Assigned' })).toEqual({ title: 'Assigned', secondary: '' })
    expect(genericNotificationText({ body: '' })).toEqual({ title: '', secondary: '' })
    expect(genericNotificationText({ title: null, body: null })).toEqual({ title: '', secondary: '' })
  })
})
