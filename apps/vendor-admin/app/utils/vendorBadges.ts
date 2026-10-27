import { statusBadgeEntry, type StatusBadgeEntry } from '@webvue/ui/app/utils/statusBadge'
import type { StatusTone } from '@webvue/ui/app/utils/statusTone'

// Status tones for the vendor console (DESIGN.md §2: tones are fixed; failed and canceled read as errors).
// Pages translate `labelKey` at the call site and hand both to SharedStatusBadge. These maps take plain
// strings so this file imports nothing from the commercial contracts (R5).
const entries = (tones: Record<string, StatusTone>, key: (value: string) => string): Record<string, StatusBadgeEntry> =>
  Object.fromEntries(Object.entries(tones).map(([value, tone]) => [value, { tone, labelKey: key(value) }]))

const CUSTOMER: Record<string, StatusTone> = { awaiting_payment: 'warning', activating: 'info', active: 'success', failed: 'destructive', inactive: 'neutral' }
const CUSTOMER_MAP = entries(CUSTOMER, value => `vendor.customers.display.${value}`)
export const customerDisplayBadge = (state: string): StatusBadgeEntry => statusBadgeEntry(CUSTOMER_MAP, state)

const OPERATION: Record<string, StatusTone> = {
  registered: 'neutral', queued: 'neutral', provisioning: 'info', running: 'info',
  active: 'success', succeeded: 'success', verified: 'success', needs_intervention: 'warning', failed: 'destructive',
}
const OPERATION_MAP = entries(OPERATION, value => `vendor.status.${value}`)
export const operationStatusBadge = (status: string): StatusBadgeEntry => statusBadgeEntry(OPERATION_MAP, status)

const ATTEMPT: Record<string, StatusTone> = { created: 'info', redirected: 'info', pending: 'info', succeeded: 'success', failed: 'destructive', canceled: 'destructive', unknown: 'neutral' }
const ATTEMPT_MAP = entries(ATTEMPT, value => `vendor.invoices.attemptStatus.${value}`)
export const paymentAttemptBadge = (status: string): StatusBadgeEntry => statusBadgeEntry(ATTEMPT_MAP, status)

const ADJUSTMENT: Record<string, StatusTone> = { pending: 'warning', applied: 'info', refunded: 'success', void: 'neutral' }
const ADJUSTMENT_MAP = entries(ADJUSTMENT, value => `vendor.invoices.adjustmentStatus.${value}`)
export const adjustmentStatusBadge = (status: string): StatusBadgeEntry => statusBadgeEntry(ADJUSTMENT_MAP, status)
