// Presentation-only governance state: tone maps for badges. Cache keys and
// route-filter parsers live in `composables/projectGovernanceKeys.ts`.
import type { ProjectRaciRole, ProjectRegisterStatus, ProjectRegisterPriority } from '@liwan/contracts'
import type { StateTone } from '@/composables/taskState'

export const REGISTER_PRIORITY_TONE: Record<ProjectRegisterPriority, StateTone> = {
  low: 'neutral',
  normal: 'neutral',
  high: 'warning',
  critical: 'destructive',
}
export const REGISTER_STATUS_TONE: Record<ProjectRegisterStatus, StateTone> = {
  open: 'info',
  in_progress: 'info',
  resolved: 'success',
  closed: 'neutral',
}
export const RACI_ROLE_TONE: Record<ProjectRaciRole, StateTone> = {
  R: 'info',
  A: 'warning',
  C: 'success',
  I: 'neutral',
}
export function registerScoreTone(score: number | null | undefined): StateTone {
  if (score == null) return 'neutral'
  if (score >= 13) return 'destructive'
  if (score >= 7) return 'warning'
  return 'info'
}
