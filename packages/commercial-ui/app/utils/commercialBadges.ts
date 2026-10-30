import { statusBadgeEntry, type StatusBadgeEntry } from '@liwan/ui/app/utils/statusBadge'
import type { StatusTone } from '@liwan/ui/app/utils/statusTone'

// Invoice status tones for the invoice lists of both consoles (DESIGN.md §2: tones are fixed; void reads as an error).
// Pages translate `labelKey` at the call site and hand both to SharedStatusBadge. The map takes plain
// strings so this file imports nothing from the commercial contracts (R5).
const INVOICE: Record<string, StatusTone> = { draft: 'neutral', issued: 'info', paid: 'success', void: 'destructive', credit_pending: 'warning' }
export function invoiceStatusBadge(status: string, labelPrefix: string): StatusBadgeEntry {
  const entries = Object.fromEntries(Object.entries(INVOICE).map(([value, tone]) => [value, { tone, labelKey: `${labelPrefix}.${value}` }]))
  return statusBadgeEntry(entries, status)
}
