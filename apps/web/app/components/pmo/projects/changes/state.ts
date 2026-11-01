// Presentation-only change request state: tone maps for badges. Cache keys and route-filter
// parsers live in `composables/projectChangeKeys.ts`.
import type { ProjectChangeState } from '@liwan/contracts'
import type { StateTone } from '@/composables/taskState'

export const CHANGE_STATE_TONE: Record<ProjectChangeState, StateTone> = {
  draft: 'neutral',
  submitted: 'info',
  approved: 'success',
  rejected: 'destructive',
  withdrawn: 'neutral',
  implemented: 'success',
}

/** A request that no longer moves: its page is a record of what was decided. */
export const CHANGE_TERMINAL_STATES: readonly ProjectChangeState[] = ['rejected', 'withdrawn', 'implemented']
