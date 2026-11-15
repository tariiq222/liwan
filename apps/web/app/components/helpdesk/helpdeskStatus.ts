import type { HelpdeskPriority } from '@liwan/contracts'
import type { StatusTone } from '@liwan/ui/app/utils/statusTone'

/** The tone of a priority badge, shared by the list and the record. */
export const HELPDESK_PRIORITY_TONE: Record<HelpdeskPriority, StatusTone> = {
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  urgent: 'destructive',
}

/** The tone of the SLA state shown beside a ticket. */
export const HELPDESK_SLA_TONE: Record<'none' | 'on_track' | 'due_soon' | 'overdue', StatusTone> = {
  none: 'neutral',
  on_track: 'success',
  due_soon: 'warning',
  overdue: 'destructive',
}
