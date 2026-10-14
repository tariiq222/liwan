import type { StatusBadgeEntry } from './statusBadge'

/** Users and roles: the label says protected / read-only / active / disabled; the colour only says active. */
export function accessStateBadge(row: { active: boolean; protected?: boolean; readOnly?: boolean }): StatusBadgeEntry {
  const labelKey = row.protected ? 'access.protected' : row.readOnly ? 'access.readOnly' : row.active ? 'access.active' : 'access.disabled'
  return { tone: row.active ? 'success' : 'neutral', labelKey }
}
