import { STATUS_COLOR } from './statusTone'

export type MeetingState = 'draft' | 'confirmed' | 'done' | 'cancelled'
export type ResolutionState = 'open' | 'in_progress' | 'done' | 'cancelled'
export type MeetingBadgeColor = (typeof STATUS_COLOR)[keyof typeof STATUS_COLOR]

/** One colour per meeting state for every meetings badge (list, calendar, detail, series). */
export function meetingStateColor(state: MeetingState | string | null | undefined): MeetingBadgeColor {
  return state === 'done' ? STATUS_COLOR.success
    : state === 'cancelled' ? STATUS_COLOR.destructive
      : state === 'confirmed' ? STATUS_COLOR.info
        : STATUS_COLOR.neutral
}

/** One colour per resolution (recommendation) state, including series follow-up filters. */
export function resolutionStateColor(state: ResolutionState | 'active' | 'overdue' | string | null | undefined): MeetingBadgeColor {
  return state === 'done' ? STATUS_COLOR.success
    : state === 'cancelled' || state === 'overdue' ? STATUS_COLOR.destructive
      : state === 'in_progress' ? STATUS_COLOR.warning
        : state === 'open' || state === 'active' ? STATUS_COLOR.info
          : STATUS_COLOR.neutral
}
