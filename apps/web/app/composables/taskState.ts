import type { TaskState } from '@webvue/contracts'
import { MANAGER_STATES } from '@webvue/contracts'
import type { StatusTone } from '@webvue/ui/app/utils/statusTone'
import { statusBadgeEntry, type StatusBadgeEntry } from '@webvue/ui/app/utils/statusBadge'

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

export type StateTone = StatusTone

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

export function deadlineLabel(days: number | null, t: (key: string, params?: Record<string, unknown>, plural?: number) => string): string {
  if (days === null) return t('tasks.deadline.none')
  if (days === 0) return t('tasks.deadline.today')
  if (days > 0) return t('tasks.deadline.inDays', { n: days }, days)
  return t('tasks.deadline.overdueDays', { n: Math.abs(days) }, Math.abs(days))
}

const TASK_STATE_BADGES = Object.fromEntries(
  (Object.keys(STATE_TONE) as TaskState[]).map(state => [state, { tone: STATE_TONE[state], labelKey: STATE_LABEL_KEY[state] }]),
) as Record<TaskState, StatusBadgeEntry>

/** The badge for a task state; an unknown state from a newer server is neutral and shows its raw value. */
export function taskStateBadge(state: TaskState): StatusBadgeEntry {
  return statusBadgeEntry(TASK_STATE_BADGES, state)
}

/** The pill tone of each priority: urgent danger, very high warning, high info, normal neutral. */
export const PRIORITY_TONE: Record<'0' | '1' | '2' | '3', StatusTone> = { '0': 'neutral', '1': 'info', '2': 'warning', '3': 'destructive' }

/** The icon of each priority, so a priority never reads by colour alone. */
export const PRIORITY_ICON: Record<'0' | '1' | '2' | '3', string> = { '0': 'i-lucide-minus', '1': 'i-lucide-chevron-up', '2': 'i-lucide-chevrons-up', '3': 'i-lucide-flame' }

export interface DeadlineTag { tone: StatusTone; icon: string }

/** How many days ahead an open task's deadline starts to warn. */
const DEADLINE_WARNING_DAYS = 2

/** The deadline tag: overdue is danger (time exceeded), today and the next two days warning, a later date info (open within time), a closed task neutral (calendar); no deadline has no tag. */
export function deadlineTag(daysRemaining: number | null, isClosed: boolean): DeadlineTag | null {
  if (daysRemaining === null) return null
  if (isClosed) return { tone: 'neutral', icon: 'i-lucide-calendar-check' }
  if (daysRemaining < 0) return { tone: 'destructive', icon: 'i-lucide-timer-off' }
  if (daysRemaining === 0) return { tone: 'warning', icon: 'i-lucide-alarm-clock' }
  return { tone: daysRemaining <= DEADLINE_WARNING_DAYS ? 'warning' : 'info', icon: 'i-lucide-hourglass' }
}

/** A closed task is never urgent; otherwise overdue is destructive and the next two days warn. */
export function deadlineTone(daysRemaining: number | null, isClosed: boolean): StatusTone {
  if (isClosed || daysRemaining === null) return 'neutral'
  if (daysRemaining < 0) return 'destructive'
  return daysRemaining <= DEADLINE_WARNING_DAYS ? 'warning' : 'neutral'
}
