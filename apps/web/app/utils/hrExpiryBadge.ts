import type { StatusBadgeEntry } from '@liwan/ui/app/utils/statusBadge'

/** Items due within this many days are urgent. */
export const HR_EXPIRY_URGENT_DAYS = 14

/** An expiring item's urgency: overdue destructive, due soon warning, otherwise info. */
export function hrExpiryTone(daysLeft: number): StatusBadgeEntry['tone'] {
  if (daysLeft < 0) return 'destructive'
  return daysLeft <= HR_EXPIRY_URGENT_DAYS ? 'warning' : 'info'
}
