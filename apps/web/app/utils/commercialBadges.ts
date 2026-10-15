import { statusBadgeEntry, type StatusBadgeEntry } from './statusBadge'
import type { StatusTone } from '@nasq/ui/app/utils/statusTone'

// Status tones for the vendor console and the subscription pages (DESIGN.md §2: tones are fixed; cancelled and void read as errors).
// Pages translate `labelKey` at the call site and hand both to SharedStatusBadge. These maps take plain
// strings so this file imports nothing from the commercial contracts (R5).
const entries = (tones: Record<string, StatusTone>, key: (value: string) => string): Record<string, StatusBadgeEntry> =>
  Object.fromEntries(Object.entries(tones).map(([value, tone]) => [value, { tone, labelKey: key(value) }]))

const INVOICE: Record<string, StatusTone> = { draft: 'neutral', issued: 'info', paid: 'success', void: 'destructive', credit_pending: 'warning' }
export function invoiceStatusBadge(status: string, labelPrefix: string): StatusBadgeEntry {
  return statusBadgeEntry(entries(INVOICE, value => `${labelPrefix}.${value}`), status)
}

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
