import type { HrEmployee } from '@nasq/contracts'
import type { StatusBadgeEntry } from './statusBadge'

/** The directory's account column: neutral outline, labelled by account state and role. */
export function hrAccessBadge(access: HrEmployee['access']): StatusBadgeEntry {
  if (!access) return { tone: 'neutral', labelKey: 'hr.directory.access.noAccount' }
  if (!access.active) return { tone: 'neutral', labelKey: 'hr.directory.access.stopped' }
  return { tone: 'neutral', labelKey: `hr.directory.access.${access.role}` }
}
