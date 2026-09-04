import type { ProjectStatus } from '@nasq/contracts'
import type { StateTone } from './taskState'

// Pure project-status helpers (no Nuxt imports) — see __tests__/projectStatus.test.ts.
export const PROJECT_STATUS_LABEL_KEY: Record<ProjectStatus, string> = {
  on_track: 'projects.status.on_track',
  at_risk: 'projects.status.at_risk',
  off_track: 'projects.status.off_track',
  on_hold: 'projects.status.on_hold',
  done: 'projects.status.done',
}
export const PROJECT_STATUS_UNSET_KEY = 'projects.status.unset'

export const PROJECT_STATUS_TONE: Record<ProjectStatus, StateTone> = {
  on_track: 'success',
  at_risk: 'warning',
  off_track: 'destructive',
  on_hold: 'neutral',
  done: 'info',
}

export function projectStatusLabelKey(status: ProjectStatus | null): string {
  return status ? PROJECT_STATUS_LABEL_KEY[status] : PROJECT_STATUS_UNSET_KEY
}
