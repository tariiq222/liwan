import type { HrLeaveState } from '@webvue/contracts'
import type { StatusBadgeEntry } from '@webvue/ui/app/utils/statusBadge'

const LEAVE_STATE_TONE: Record<HrLeaveState, StatusBadgeEntry['tone']> = {
  confirm: 'info',
  validate1: 'info',
  validate: 'success',
  refuse: 'destructive',
  cancel: 'neutral',
}

/** A leave request's state: waiting info, approved success, refused destructive, cancelled neutral. */
export function hrLeaveBadge(state: HrLeaveState): StatusBadgeEntry {
  return { tone: LEAVE_STATE_TONE[state], labelKey: `hr.leave.state.${state}` }
}
