import type { Project, ProjectStatus } from '@webvue/contracts'
import { formatCalendarDate } from '@webvue/ui/app/composables/calendarDate'
import { deadlineLabel, deadlineTag } from '../../../composables/taskState'
import { projectStatusBadge } from '../../../composables/projectStatus'
import { badgeLabel } from '@webvue/ui/app/utils/statusBadge'

// What the project list says about a project at a glance: its status pill, its end-date pill and the colour of its
// progress bar. Pure and shared by the card, the table row and the phone row, so the three never disagree.
type Translate = Parameters<typeof deadlineLabel>[1]
type HealthInput = Pick<Project, 'status' | 'progress' | 'date_end'>

export type ProgressTone = 'primary' | 'success' | 'warning' | 'danger'

/** The status pill of a project (an unset status reads as such). */
export function projectStatusPill(status: ProjectStatus | null, t: (key: string) => string) {
  const entry = projectStatusBadge(status)
  return { tone: entry.tone, label: badgeLabel(entry, status, t) }
}

/** A finished project is never late: status done or every task closed. */
export function projectIsFinished(project: Pick<Project, 'status' | 'progress'>): boolean {
  return project.status === 'done' || project.progress >= 100
}

/** Calendar days from today to the end date (a YYYY-MM-DD string, read as a local calendar day), or null without one. */
export function projectDaysRemaining(dateEnd: string | null | undefined, now: Date = new Date()): number | null {
  const match = dateEnd ? /^(\d{4})-(\d{2})-(\d{2})/.exec(dateEnd) : null
  if (!match) return null
  const end = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((end - today) / 86_400_000)
}

/** The end-date pill (tone, icon, label, full date as title), or null without an end date. A finished project shows its date, neutral. */
export function projectEndTagView(project: HealthInput, t: Translate, now: Date = new Date()) {
  const days = projectDaysRemaining(project.date_end, now)
  const finished = projectIsFinished(project)
  const tag = deadlineTag(days, finished)
  if (!tag) return null
  const date = formatCalendarDate(project.date_end ?? null)
  return { ...tag, label: finished ? date : deadlineLabel(days, t), title: date }
}

/** Danger when late (past its end date or off track), warning when at risk, success when finished, primary otherwise. */
export function projectProgressTone(project: HealthInput, now: Date = new Date()): ProgressTone {
  if (projectIsFinished(project)) return 'success'
  const days = projectDaysRemaining(project.date_end, now)
  if (project.status === 'off_track' || (days !== null && days < 0)) return 'danger'
  return project.status === 'at_risk' ? 'warning' : 'primary'
}
