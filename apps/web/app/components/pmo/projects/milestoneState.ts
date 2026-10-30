import type { Milestone } from '@liwan/contracts'
import { getLocalTimeZone, today } from '@internationalized/date'
import { toCalendarDate } from '@liwan/ui/app/composables/calendarDate'

type MilestoneInput = Pick<Milestone, 'is_reached' | 'deadline'>

// A milestone deadline is a calendar date, not an instant (see calendarDate.ts): comparing it against `today()` in
// the viewer's own timezone avoids the UTC-midnight shift `new Date(...)` would introduce.
function isPastDeadline(deadline: string | null): boolean {
  const date = toCalendarDate(deadline)
  return !!date && date.compare(today(getLocalTimeZone())) < 0
}

export function isMilestoneOverdue(milestone: MilestoneInput): boolean {
  return !milestone.is_reached && isPastDeadline(milestone.deadline)
}

/** The milestone's state badge: reached is success, open is info (upcoming), past its deadline is destructive (overdue). */
export function milestoneBadge(milestone: MilestoneInput) {
  if (milestone.is_reached) return { tone: 'success' as const, labelKey: 'projects.milestones.reached' }
  return isMilestoneOverdue(milestone)
    ? { tone: 'destructive' as const, labelKey: 'projects.milestones.overdue' }
    : { tone: 'info' as const, labelKey: 'projects.milestones.upcoming' }
}
