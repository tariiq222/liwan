import type { Task } from '@webvue/contracts'

// Calendar days from today to the deadline, both read in the viewer's local zone - the same zone the
// Deadline property prints its date in. The server's `days_remaining` counts UTC dates, so around
// midnight (or on a stale cached row) it can disagree with the date shown beside it; whenever a
// deadline exists this is derived from it instead, and the server value is only the fallback.
export function taskDaysRemaining(task: Pick<Task, 'date_deadline' | 'days_remaining'>, now: Date = new Date()): number | null {
  if (!task.date_deadline) return task.days_remaining
  const deadline = new Date(task.date_deadline)
  if (Number.isNaN(deadline.getTime())) return task.days_remaining
  const deadlineDay = Date.UTC(deadline.getFullYear(), deadline.getMonth(), deadline.getDate())
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((deadlineDay - today) / 86_400_000)
}
