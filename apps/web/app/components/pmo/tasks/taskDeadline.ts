import type { Task } from '@webvue/contracts'
import { deadlineLabel, deadlineTag } from '../../../composables/taskState'
import { formatDate } from '@webvue/ui/app/utils/formatDate'

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

/** The deadline tag of a task (tone, icon, label and the full date as tooltip), or null without a deadline (no tag is drawn). */
export function deadlineTagView(task: Pick<Task, 'date_deadline' | 'days_remaining' | 'is_closed'>, t: Parameters<typeof deadlineLabel>[1]) {
  const days = taskDaysRemaining(task)
  const tag = deadlineTag(days, task.is_closed)
  if (!tag) return null
  const date = task.date_deadline ? formatDate(task.date_deadline) : undefined
  return { ...tag, label: task.is_closed && date ? date : deadlineLabel(days, t), title: date }
}
