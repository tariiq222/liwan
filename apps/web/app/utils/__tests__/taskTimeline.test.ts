import { describe, expect, it } from 'vitest'
import { formatTimelineChange, formatTimelineValue } from '../taskTimeline'

const labels: Record<string, string> = {
  'tasks.columns.title': 'Title',
  'tasks.columns.deadline': 'Deadline',
  'tasks.drawer.archive': 'Archived',
  'tasks.activity.set': 'Set {field}: {new}',
  'tasks.activity.changed': 'Changed {field} from {old} to {new}',
  'tasks.activity.cleared': 'Cleared {field}',
  'tasks.activity.unset': 'Not set',
  'tasks.activity.invalidValue': 'Invalid value',
  'tasks.activity.booleanTrue': 'Yes',
  'tasks.activity.booleanFalse': 'No',
}

function t(key: string, params?: Record<string, unknown>): string {
  let result = labels[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) result = result.replace(`{${name}}`, String(value))
  return result
}

describe('task timeline value formatting', () => {
  it('treats a cleared date represented as false as unset when setting a date', () => {
    const message = formatTimelineChange({ field: 'date_deadline', label: 'الموعد', old: false, new: '2030-09-01' }, 'en-US', t)
    expect(message).toContain('Set Deadline')
    expect(message).toContain('Sep')
    expect(message).not.toContain('false')
  })

  it('keeps false meaningful for known boolean fields', () => {
    const message = formatTimelineChange({ field: 'active', label: 'الحالة', old: true, new: false }, 'en-US', t)
    expect(message).toBe('Changed Archived from Yes to No')
  })

  it('handles invalid dates and unknown objects without raw technical output', () => {
    expect(formatTimelineValue('date_deadline', '2030-02-31', 'en-US', t)).toBe('Invalid value')
    const message = formatTimelineChange({ field: 'custom_field', label: 'حقل', old: null, new: { id: 7, name: 'External' } }, 'en-US', t)
    expect(message).not.toContain('[object Object]')
    expect(message).toContain('External')
  })

  it('uses local field labels instead of the server supplied label', () => {
    expect(formatTimelineChange({ field: 'name', label: 'لقب', old: null, new: 'Launch' }, 'en-US', t)).toBe('Set Title: Launch')
  })
})
