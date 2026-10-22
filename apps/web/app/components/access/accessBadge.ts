import { accessStateBadge } from '../../utils/accessStateBadge'
import type { StatusBadgeEntry } from '@webvue/ui/app/utils/statusBadge'

interface AccessBadge extends StatusBadgeEntry {
  icon?: string
}

/** Protected accounts and roles are locked, not "successful": an info badge with a lock, never the green active tone. */
export function accessBadge(row: { active: boolean; protected?: boolean; readOnly?: boolean }): AccessBadge {
  const entry = accessStateBadge(row)
  return row.protected ? { ...entry, tone: 'info', icon: 'i-lucide-lock' } : entry
}
