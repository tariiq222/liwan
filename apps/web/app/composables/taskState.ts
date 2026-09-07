import type { TaskState } from '@nasq/contracts'
import { MANAGER_STATES } from '@nasq/contracts'

// Pure state/priority helpers, kept free of Nuxt/vue-query imports so they can
// be unit tested directly (see __tests__/taskState.test.ts).

export const STATE_LABEL_KEY: Record<TaskState, string> = {
  in_progress: 'tasks.state.in_progress',
  changes_requested: 'tasks.state.changes_requested',
  approved: 'tasks.state.approved',
  waiting: 'tasks.state.waiting',
  done: 'tasks.state.done',
  cancelled: 'tasks.state.cancelled',
}

export type StateTone = 'neutral' | 'info' | 'warning' | 'success' | 'destructive'

export const STATE_TONE: Record<TaskState, StateTone> = {
  in_progress: 'info',
  changes_requested: 'warning',
  approved: 'success',
  waiting: 'neutral',
  done: 'success',
  cancelled: 'destructive',
}

export const PRIORITY_LABEL_KEY: Record<'0' | '1' | '2' | '3', string> = {
  '0': 'tasks.priority.0',
  '1': 'tasks.priority.1',
  '2': 'tasks.priority.2',
  '3': 'tasks.priority.3',
}

// Fixed display order for pickers/menus, not the enum's declaration order.
const ALL_STATES: TaskState[] = ['in_progress', 'waiting', 'changes_requested', 'approved', 'done', 'cancelled']

export function canTransition(from: TaskState, to: TaskState, canApprove: boolean): boolean {
  if (to === from) return false
  if (MANAGER_STATES.includes(to) && !canApprove) return false
  return true
}

export function nextStates(from: TaskState, canApprove: boolean): TaskState[] {
  return ALL_STATES.filter((s) => s !== from && !(MANAGER_STATES.includes(s) && !canApprove))
}

// Calendar-date difference in UTC: deadlines are dates, not instants, so a
// deadline "today" at any time of day must compare equal, not fractional.
export function daysRemaining(deadlineIso: string | null | undefined, now: Date = new Date()): number | null {
  if (!deadlineIso) return null
  const deadline = new Date(deadlineIso)
  const deadlineUTC = Date.UTC(deadline.getUTCFullYear(), deadline.getUTCMonth(), deadline.getUTCDate())
  const nowUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((deadlineUTC - nowUTC) / 86_400_000)
}

export function deadlineLabel(days: number | null, t: (key: string, params?: Record<string, unknown>) => string): string {
  if (days === null) return t('tasks.deadline.none')
  if (days === 0) return t('tasks.deadline.today')
  if (days === 1) return t('tasks.deadline.tomorrow')
  if (days > 1) return t('tasks.deadline.inDays', { n: days })
  return t('tasks.deadline.overdueDays', { n: Math.abs(days) })
}

/** Approval can be assigned without general task editing. */
export function permittedNextStates(current: TaskState, canWrite: boolean, canApprove: boolean): TaskState[] {
  return nextStates(current, canApprove).filter(state => canWrite || (canApprove && MANAGER_STATES.includes(state)))
}
