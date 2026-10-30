import type { HrEmployee } from '@liwan/contracts'
import type { StatusBadgeEntry } from '@liwan/ui/app/utils/statusBadge'

/** The directory's account column: system admin primary, active account success, stopped warning, no account neutral. */
export function hrAccessBadge(access: HrEmployee['access']): StatusBadgeEntry {
  if (!access) return { tone: 'neutral', labelKey: 'hr.directory.access.noAccount' }
  if (!access.active) return { tone: 'warning', labelKey: 'hr.directory.access.stopped' }
  return { tone: access.role === 'admin' ? 'primary' : 'success', labelKey: `hr.directory.access.${access.role}` }
}
