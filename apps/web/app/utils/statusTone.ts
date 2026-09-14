import type { ProjectStatus, TaskState } from '@nasq/contracts'
import type { StateTone } from '@/composables/taskState'

export const STATUS_COLOR = {
  neutral: 'neutral', info: 'info', warning: 'warning', success: 'success', destructive: 'error',
} as const satisfies Record<StateTone, 'neutral' | 'info' | 'warning' | 'success' | 'error'>

// Tones of the shared `nasq-ui-status-pill` recipe (components.css). Each one
// resolves to a fixed --state-*/--priority-* token, never the brand colour.
export type PillTone =
  | TaskState
  | ProjectStatus
  | 'urgent' | 'high' | 'normal' | 'low'
  | 'overdue' | 'soon' | 'neutral'
  | 'granted' | 'pending' | 'disabled'

export const PRIORITY_TONE = { '0': 'low', '1': 'normal', '2': 'high', '3': 'urgent' } as const satisfies Record<'0' | '1' | '2' | '3', PillTone>

const STATE_TONE_PILL: Record<StateTone, PillTone> = {
  info: 'in_progress', warning: 'changes_requested', success: 'done', neutral: 'waiting', destructive: 'cancelled',
}
export function stateToneToPill(tone: StateTone): PillTone {
  return STATE_TONE_PILL[tone]
}

// A closed task is never urgent regardless of how the deadline compares to today.
export function deadlineTone(daysRemaining: number | null, isClosed: boolean): PillTone {
  if (isClosed || daysRemaining === null) return 'neutral'
  if (daysRemaining < 0) return 'overdue'
  if (daysRemaining <= 2) return 'soon'
  return 'neutral'
}

export function accessTone(active: boolean | null | undefined): PillTone {
  if (active === null || active === undefined) return 'neutral'
  return active ? 'granted' : 'disabled'
}
