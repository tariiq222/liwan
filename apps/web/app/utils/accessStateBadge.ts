import type { StatusBadgeEntry } from './statusBadge'

/** Users and roles: a protected system record reads primary, active is success, stopped warns, read-only is neutral. */
export function accessStateBadge(row: { active: boolean; protected?: boolean; readOnly?: boolean }): StatusBadgeEntry {
  if (row.protected) return { tone: 'primary', labelKey: 'access.protected' }
  if (row.readOnly) return { tone: 'neutral', labelKey: 'access.readOnly' }
  return row.active ? { tone: 'success', labelKey: 'access.active' } : { tone: 'warning', labelKey: 'access.disabled' }
}
