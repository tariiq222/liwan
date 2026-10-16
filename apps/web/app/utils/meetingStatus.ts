import { badgeLabel, statusBadgeEntry, type StatusBadgeEntry } from '@webvue/ui/app/utils/statusBadge'
import type { StatusTone } from '@webvue/ui/app/utils/statusTone'

export type MeetingState = 'draft' | 'confirmed' | 'done' | 'cancelled'
export type ResolutionState = 'open' | 'in_progress' | 'done' | 'cancelled'

const MEETING_STATE_BADGES: Readonly<Record<MeetingState, StatusBadgeEntry>> = {
  draft: { tone: 'neutral', labelKey: 'meetingsUi.state.draft' },
  confirmed: { tone: 'info', labelKey: 'meetingsUi.state.confirmed' },
  done: { tone: 'success', labelKey: 'meetingsUi.state.done' },
  cancelled: { tone: 'destructive', labelKey: 'meetingsUi.state.cancelled' },
}

const RESOLUTION_STATE_BADGES: Readonly<Record<ResolutionState | 'active' | 'overdue', StatusBadgeEntry>> = {
  open: { tone: 'info', labelKey: 'meetingsUi.resolutionState.open' },
  in_progress: { tone: 'warning', labelKey: 'meetingsUi.resolutionState.in_progress' },
  done: { tone: 'success', labelKey: 'meetingsUi.resolutionState.done' },
  cancelled: { tone: 'destructive', labelKey: 'meetingsUi.resolutionState.cancelled' },
  // The series follow-up filters: the tab words them itself (followupStateLabel), so there is no key here.
  active: { tone: 'info', labelKey: '' },
  overdue: { tone: 'destructive', labelKey: '' },
}

export function meetingStateBadge(state: string | null | undefined): StatusBadgeEntry {
  return statusBadgeEntry(MEETING_STATE_BADGES, state)
}

export function resolutionStateBadge(state: string | null | undefined): StatusBadgeEntry {
  return statusBadgeEntry(RESOLUTION_STATE_BADGES, state)
}

type BadgeProps = { tone: StatusTone; label: string }

/** The props `SharedStatusBadge` takes for a meeting state. */
export function meetingStateBadgeProps(state: string | null | undefined, t: (key: string) => string): BadgeProps {
  const entry = meetingStateBadge(state)
  return { tone: entry.tone, label: badgeLabel(entry, state, t) }
}

/** The props `SharedStatusBadge` takes for a recommendation state; `label` replaces the translated text. */
export function resolutionStateBadgeProps(state: string | null | undefined, t: (key: string) => string, label?: string): BadgeProps {
  const entry = resolutionStateBadge(state)
  return { tone: entry.tone, label: label ?? badgeLabel(entry, state, t) }
}
