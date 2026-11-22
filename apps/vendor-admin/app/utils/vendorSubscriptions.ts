import type { StatusBadgeEntry } from '@liwan/ui/app/utils/statusBadge'
import { daysBetween, riyadhDate, subscriptionDisplayState, type Adjustment, type BankTransferClaim, type Cadence, type Invoice, type InvoiceLine, type Money, type Order, type SignupAcceptance, type SubscriptionDisplayState, type SubscriptionView, type VoidBlock, type UsageMetric } from '@liwan/commercial-contracts'
import { commercialErrorKey, commercialFailure, CURRENCY, emptyLimit, limitFromDraft, minorToInput, normalizeDigits, parseCount, parseVendorMoneyInput, sar, type LimitDraft } from './vendorCommercial'
import type { OwnerOnlyAccess } from './ownerOnly'
import { MB_PER_GB } from './storage'
import { formatCommercialMoney } from '@liwan/commercial-ui/app/utils/commercial'
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import { humanizeId } from '@liwan/ui/app/utils/humanizeId'
import { invoiceLineQuantities, type InvoiceLineView } from '@liwan/commercial-ui/app/utils/invoiceLines'

export { subscriptionDisplayState }
export type VendorCustomer = { id: string; name: string; tenant_id: string | null; admin_login: string | null; commercial_setup_required: boolean; signup_acceptance: SignupAcceptance | null; subscription: SubscriptionView | null }
export type VendorCustomerList = { items: VendorCustomer[]; total: number }
/** Vendor invoice views carry the customer's name (joined server-side); the customer-facing invoice contract does not. */
/** Whether the owner may still refund this invoice's payment (only the customer's first payment, inside the window), and
 * whether recording its pending refund drops the subscription to the free base. */
export type VendorRefundability = { refundable: boolean; first_payment: boolean; until: string | null; window_days: number; locks_subscription: boolean }
/** The refund the system makes through the payment provider for a note the vendor requested; the server sets it only for a card payment. */
export type VendorAutomaticRefund = { state: 'in_progress' | 'refunded_recording' | 'provider_unverified' | 'done' | 'failed'; reason: string | null }
/** A credit note with what the server allows: `manual_record_allowed` is true only with no automatic refund, or one that failed with no money returned. */
export type VendorAdjustment = Adjustment & { automatic_refund: VendorAutomaticRefund | null; manual_record_allowed: boolean }
/** `voidable`: the unpaid renewal invoice can be voided now; `void_block`: why it cannot, when the action applies but is blocked (null with `voidable` false means it does not apply). */
export type VendorInvoice = Invoice & { customer_name: string; adjustments: VendorAdjustment[]; bank_transfer_claim: BankTransferClaim | null; refund: VendorRefundability; voidable: boolean; void_block: VoidBlock | null }
export type VendorInvoiceList = { items: VendorInvoice[]; total: number; summary: { outstanding: Money[] } }

// ---- Filters (URL-backed) ----
export const INVOICE_STATUS_FILTERS = ['all', 'draft', 'issued', 'paid', 'void', 'credit_pending'] as const
export type InvoiceStatusFilter = (typeof INVOICE_STATUS_FILTERS)[number]
export const isInvoiceStatusFilter = (v: unknown): v is InvoiceStatusFilter => typeof v === 'string' && (INVOICE_STATUS_FILTERS as readonly string[]).includes(v)

export function invoiceListQuery(p: { customerId?: string; status?: string; page: number; pageSize: number }) {
  return { customer_id: p.customerId || undefined, status: p.status && p.status !== 'all' ? p.status : undefined, limit: p.pageSize, offset: (p.page - 1) * p.pageSize }
}

// ---- Display states ----
export const displayStateColor = (s: SubscriptionDisplayState) => ({ awaiting_payment: 'warning', activating: 'info', active: 'success', failed: 'error', inactive: 'neutral' } as const)[s]
export function customerDisplayState(c: Pick<VendorCustomer, 'subscription'>): SubscriptionDisplayState | null {
  return c.subscription ? subscriptionDisplayState(c.subscription) : null
}
/** Applied vs pending target, stated honestly: a target never reads as applied. */
export type TargetStatus = 'none' | 'applied_only' | 'target_pending' | 'target_failed' | 'target_unapplied'
export function targetStatus(view: Pick<SubscriptionView, 'applied' | 'target' | 'pending_order'>): TargetStatus {
  const o = view.pending_order
  if (o && (o.fulfillment_state === 'failed' || o.fulfillment_state === 'needs_intervention')) return 'target_failed'
  if (o) return 'target_pending'
  if (view.target && view.target.id !== view.applied?.id) return 'target_unapplied'
  return view.applied ? 'applied_only' : 'none'
}
export const orderBadgeColor = (o: Pick<Order, 'payment_state' | 'fulfillment_state'>) => {
  if (o.fulfillment_state === 'failed' || o.fulfillment_state === 'needs_intervention' || o.payment_state === 'refund_pending') return 'error' as const
  if (o.fulfillment_state === 'applied') return 'success' as const
  if (o.payment_state === 'awaiting_payment') return 'warning' as const
  return 'info' as const
}

const ORDER_TONE = { error: 'destructive', success: 'success', warning: 'warning', info: 'info' } as const

/** The payment badge's colour reads both states (orderBadgeColor); its label is the payment state. */
export function orderPaymentBadge(order: Pick<Order, 'payment_state' | 'fulfillment_state'>): StatusBadgeEntry {
  return { tone: ORDER_TONE[orderBadgeColor(order)], labelKey: `vendor.customers.payment.${order.payment_state}` }
}

export function orderFulfillmentBadge(order: Pick<Order, 'fulfillment_state'>): StatusBadgeEntry {
  return { tone: 'neutral', labelKey: `vendor.customers.fulfillment.${order.fulfillment_state}` }
}

// ---- Branches / usage ----
// ---- Customer glance: renewal countdown and stalled activation, matching the control plane's 24-hour threshold ----
export const STALLED_HOURS = 24
/** Whole calendar days from today to `isoDate`, both read in Riyadh time (the business day the control plane renews on). */
export function daysUntilDate(isoDate: string, now: Date): number {
  return daysBetween(riyadhDate(now), isoDate)
}
export function isStalled(order: Order | null, now: Date): boolean {
  if (!order) return false
  if (order.fulfillment_state === 'failed' || order.fulfillment_state === 'needs_intervention') return true
  if (order.fulfillment_state === 'queued' || order.fulfillment_state === 'applying') {
    const created = Date.parse(order.created_at)
    return Number.isFinite(created) && now.getTime() - created > STALLED_HOURS * 3_600_000
  }
  return false
}

export function branchSummaryText(s: { free_extra_used: number; free_extra_allowed: number; paid: number; limit: number | null }) {
  return { hq: 1, freeUsed: s.free_extra_used, freeAllowed: s.free_extra_allowed, paid: s.paid, limit: s.limit }
}
/** Unavailable usage is shown as unavailable, never as 0. */
export function usageDisplay(m: Pick<UsageMetric, 'used' | 'limit'>): { available: boolean; used: number | null; limit: number | null; ratio: number | null } {
  if (m.used === null) return { available: false, used: null, limit: m.limit, ratio: null }
  return { available: true, used: m.used, limit: m.limit, ratio: m.limit && m.limit > 0 ? Math.min(1, m.used / m.limit) : null }
}
/** A usage row's label: its limit key's translation, else its unit's, else a readable id. */
export function usageMetricLabel(metric: Pick<UsageMetric, 'key' | 'unit'>, t: (key: string) => string, te: (key: string) => boolean): string {
  const byKey = `vendor.customers.usage.keys.${metric.key.replace(/\./g, '_')}`
  if (te(byKey)) return t(byKey)
  const byUnit = `vendor.customers.usage.units.${metric.unit}`
  if (te(byUnit)) return t(byUnit)
  return humanizeId(metric.key)
}

// ---- Invoices ----
export const invoiceStatusColor = (s: Invoice['status']) => ({ draft: 'neutral', issued: 'info', paid: 'success', void: 'neutral', credit_pending: 'warning' } as const)[s]
export function lineQuantities(line: Pick<InvoiceLine, 'quantity' | 'free_quantity'>): { free: number | null; paid: number } {
  return invoiceLineQuantities(line)
}
/** The vendor invoice table: kind badge, free / paid / unit / period cells and the amount. */
export function vendorInvoiceLineViews(lines: Invoice['lines'], t: (key: string) => string, locale: string): InvoiceLineView[] {
  return lines.map((line) => {
    const q = lineQuantities(line)
    return {
      id: line.key,
      description: line.description,
      kind: { label: t(`vendor.invoices.lineKind.${line.kind}`), tone: 'neutral' },
      cells: [
        { key: 'free', label: t('vendor.invoices.line.free'), value: q.free === null ? t('app.notAvailable') : String(q.free) },
        { key: 'paid', label: t('vendor.invoices.line.paid'), value: String(q.paid) },
        { key: 'unit', label: t('vendor.invoices.line.unit'), value: formatCommercialMoney(line.unit_amount, locale) },
        { key: 'period', label: t('vendor.invoices.line.period'), value: `${line.period_start} → ${line.period_end}` },
      ],
      amount: formatCommercialMoney(line.amount, locale),
    }
  })
}

/** A refund reason (recording a refund or requesting one) is bounded like the server's contract. */
export const validRefundReason = (reason: string) => reason.trim().length >= 3 && reason.trim().length <= 1000
/** Recording a refund: the reference and reason are required and bounded like the server's contract. */
export const validRefundDraft = (d: { reference: string; reason: string }) =>
  d.reference.trim().length >= 3 && d.reference.trim().length <= 200 && validRefundReason(d.reason)

export type RefundRequestBlock = 'alreadyRequested' | 'windowClosed' | 'notFirstPayment'
/**
 * Why the vendor cannot ask for this paid invoice's refund now, or null when they can. The server judges the window and
 * the customer's first payment (`refund`); a vendor credit note that is not void means the request was already made, or
 * already recorded, and the server refuses a second one. A system note never blocks it.
 */
export function refundRequestBlock(invoice: Pick<VendorInvoice, 'refund'> & { adjustments: Adjustment[] }): RefundRequestBlock | null {
  if (invoice.adjustments.some(note => note.origin === 'vendor' && note.kind === 'credit_note' && note.status !== 'void')) return 'alreadyRequested'
  if (invoice.refund.refundable) return null
  return invoice.refund.first_payment ? 'windowClosed' : 'notFirstPayment'
}
/**
 * Whether the invoice is refunded through the AI top-up route instead of the general refund request: a paid invoice that bought
 * only an AI top-up (tax aside), whose payment is NOT the customer's first (the general refund refuses those) and is still inside
 * the window, with no credit note of any kind yet. Whether the units are unused is the operator's statement, judged by the server.
 * `first_payment` is false here by definition, so this and a refundable invoice (always a first payment) never both hold.
 */
export function aiTopupRefundable(invoice: Pick<VendorInvoice, 'status' | 'order_id' | 'lines' | 'refund'> & { adjustments: Adjustment[] }, now: Date = new Date()): boolean {
  if (invoice.status !== 'paid' || !invoice.order_id || invoice.refund.first_payment || !invoice.refund.until) return false
  if (!invoiceHasAiTopup(invoice) || invoice.lines.some(line => line.kind !== 'ai_topup' && line.kind !== 'tax' && line.amount.minor > 0)) return false
  if (invoice.adjustments.some(note => note.kind === 'credit_note' && note.status !== 'void')) return false
  return now.getTime() <= Date.parse(invoice.refund.until)
}
/** An invoice whose order carries an AI top-up: the control plane then needs the units already spent before it opens the refund. */
export const invoiceHasAiTopup = (invoice: Pick<VendorInvoice, 'lines'>) => invoice.lines.some(line => line.kind === 'ai_topup')
/** AI units already spent, as the operator read them in the tenant: a non-negative whole number (Arabic-Indic digits included), bounded like the control plane's `units_used`. */
export function parseUnitsUsed(text: string): number | null {
  const digits = normalizeDigits(text).trim()
  if (!/^\d+$/.test(digits)) return null
  const units = Number(digits)
  return Number.isSafeInteger(units) ? units : null
}
export function refundErrorKey(cause: unknown): string {
  const code = commercialFailure(cause).code
  // The release-1 window rules have their own words: the vendor needs to know which one stopped the refund.
  return ['credit_note_not_pending', 'refund_reference_in_use', 'refund_window_closed', 'refund_not_first_payment', 'units_used_required', 'ai_topup_used', 'lock_pending', 'fulfillment_pending', 'refund_in_progress', 'ai_topup_refund_mixed_order'].includes(code)
    ? `vendor.invoices.refund.errors.${code}` : commercialErrorKey(cause)
}

// ---- Void of an unpaid renewal invoice ----
export type VoidAction = { kind: 'hidden' } | { kind: 'available' } | { kind: 'blocked'; block: VoidBlock } | { kind: 'ownerOnly' }
/**
 * What the invoice page shows for voiding an unpaid renewal invoice. The server decides whether it applies (`voidable`, `void_block`);
 * the page adds only who may ask (both grants the route needs; an account holding one of them is told the platform owner voids) and that it never sits beside a refund: an invoice with a refund note
 * has had money move, so voiding it is not offered. A paid invoice is refunded, never voided, so the two actions cover different statuses.
 */
export function voidAction(invoice: Pick<VendorInvoice, 'status' | 'kind' | 'voidable' | 'void_block'> & { adjustments: Pick<Adjustment, 'status'>[] }, access: OwnerOnlyAccess): VoidAction {
  if (access === 'none' || invoice.status !== 'issued' || invoice.kind !== 'renewal' || invoice.adjustments.some(note => note.status !== 'void')) return { kind: 'hidden' }
  if (!invoice.void_block && !invoice.voidable) return { kind: 'hidden' }
  if (access === 'partial') return { kind: 'ownerOnly' }
  return invoice.void_block ? { kind: 'blocked', block: invoice.void_block } : { kind: 'available' }
}
/** The vendor chooses what happens to the subscription and states why; the reason is bounded like the server's contract. */
export const validVoidDraft = (d: { outcome: string; reason: string }) => (d.outcome === 'end' || d.outcome === 'rebill') && validRefundReason(d.reason)
const VOID_REASON_CODES = ['invoice_not_voidable', 'payment_reconciliation_required', 'transfer_claimed', 'renewal_in_progress', 'lock_pending', 'tenant_retiring', 'subscription_suspended', 'subscription_change_pending', 'invoice_void_retry']
/** The sentence for a block the invoice view carries or a refusal the void route answers: both say what the vendor does next. */
export const voidReasonKey = (code: string) => `vendor.invoices.void.reason.${code}`
export function voidErrorKey(cause: unknown): string {
  const code = commercialFailure(cause).code
  return VOID_REASON_CODES.includes(code) ? voidReasonKey(code) : commercialErrorKey(cause)
}

// ---- Bank transfer form ----
/** The form opens on the invoice total, today's date in Riyadh (the calendar of the bank statement, never the UTC day) and an empty reference: the vendor types the date and reference from the bank statement, never from what the customer claimed. */
export function transferFormDefaults(total: Money, now: Date = new Date()): { amount: string; valueDate: string; reference: string } {
  return { amount: minorToInput(total.minor, total.exponent), valueDate: riyadhDate(now), reference: '' }
}
export type TransferAmount = { minor: number } | { issue: 'invalid' | 'decimals' }
/** The amount in riyals as typed (Arabic-Indic digits included) → minor units. More decimals than the currency has is refused, never rounded. */
export function parseTransferAmount(text: string, exponent: number): TransferAmount {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(normalizeDigits(text))
  if (!match) return { issue: 'invalid' }
  if ((match[2] ?? '').length > exponent) return { issue: 'decimals' }
  const minor = parseVendorMoneyInput(text, exponent)
  return minor === null ? { issue: 'invalid' } : { minor }
}

// ---- Errors: routes may not exist yet ----
export function isNotAvailable(cause: unknown): boolean {
  const e = cause as { status?: number; statusCode?: number; response?: { status?: number } } | null
  const status = e?.status ?? e?.statusCode ?? e?.response?.status
  return status === 404 || status === 501
}

// ---- Customer terms form ↔ payload ----
export type TermsDraft = {
  basePrice: string; baseUnit: '' | 'month' | 'year'; baseCount: string
  includedExtraBranches: string; extraBranchPrice: string; extraBranchUnit: '' | 'month' | 'year'; extraBranchCount: string
  extraBranchesLimit: LimitDraft; termMonths: string; reason: string
}
export const emptyTermsDraft = (): TermsDraft => ({
  basePrice: '', baseUnit: '', baseCount: '1', includedExtraBranches: '', extraBranchPrice: '', extraBranchUnit: '', extraBranchCount: '1',
  extraBranchesLimit: emptyLimit(), termMonths: '', reason: '',
})
export type TermsPayload = {
  customer_id: string; reason: string; base_price?: { cadence: Cadence; amount: ReturnType<typeof sar> }
  included_extra_branches?: number; extra_branch_price?: { cadence: Cadence; amount: ReturnType<typeof sar> }
  extra_branches_limit?: number | null; term_months?: number
}
function price(amount: string, unit: string, count: string) {
  const minor = parseVendorMoneyInput(amount); const n = parseCount(count, 12)
  if (minor === null || !unit || n === null || n < 1) throw new Error('invalid_price')
  return { cadence: { unit: unit as 'month' | 'year', count: n }, amount: sar(minor) }
}
const touched = (l: LimitDraft) => l.mode !== ''
/** Only fields the vendor actually filled are sent; blank means "no override" (inherit the plan), never 0. Throws when nothing is overridden. */
export function termsPayload(customerId: string, d: TermsDraft): TermsPayload {
  const out: TermsPayload = { customer_id: customerId, reason: d.reason.trim() }
  if (d.basePrice.trim()) out.base_price = price(d.basePrice, d.baseUnit, d.baseCount)
  if (d.includedExtraBranches.trim()) { const n = parseCount(d.includedExtraBranches); if (n === null) throw new Error('invalid_count'); out.included_extra_branches = n }
  if (d.extraBranchPrice.trim()) out.extra_branch_price = price(d.extraBranchPrice, d.extraBranchUnit, d.extraBranchCount)
  if (touched(d.extraBranchesLimit)) out.extra_branches_limit = limitFromDraft(d.extraBranchesLimit)
  if (d.termMonths.trim()) { const n = parseCount(d.termMonths, 120); if (n === null || n < 1) throw new Error('invalid_count'); out.term_months = n }
  if (Object.keys(out).length <= 2 || out.reason.length < 3) throw new Error('invalid_terms')
  return out
}
export function hasTermsOverride(d: TermsDraft): boolean {
  try { termsPayload('x', { ...d, reason: d.reason.trim().length >= 3 ? d.reason : 'xxx' }); return true } catch { return false }
}
/** What the quote request names of the plan being ordered. */
type PlanChoice = { included_bundle_revision_ids: string[]; optional_bundle_revision_ids: string[]; included_users: number; included_storage_mb: number }
/** The bundles of an order: the plan's included ones and, of `chosen`, those the plan offers as optional. A bundle only the old plan allowed is refused by the server (`bundle_not_allowed`), so it is never carried over. */
export function planBundleIds(plan: Pick<PlanChoice, 'included_bundle_revision_ids' | 'optional_bundle_revision_ids'>, chosen: Iterable<string>): string[] {
  const wanted = new Set(chosen)
  return [...plan.included_bundle_revision_ids, ...plan.optional_bundle_revision_ids.filter(id => wanted.has(id))]
}
/** The requested totals for users and storage: the plan's inclusions plus what is bought on top. */
export function requestedQuantities(plan: Pick<PlanChoice, 'included_users' | 'included_storage_mb'>, paid: { paidUsers: number; paidStorageGb: number }) {
  return { users: plan.included_users + paid.paidUsers, storageMb: plan.included_storage_mb + paid.paidStorageGb * MB_PER_GB }
}
/** What the customer holds above `plan`'s inclusions today: a plan change keeps their totals instead of dropping paid users and storage. */
export function currentPaidQuantities(plan: Pick<PlanChoice, 'included_users' | 'included_storage_mb'>, view: SubscriptionView | null): { paidUsers: number; paidStorageGb: number } {
  const base = view?.target ?? view?.applied
  if (!base) return { paidUsers: 0, paidStorageGb: 0 }
  return {
    paidUsers: Math.max(0, Number(base.entitlement.features['users.limit'] ?? 0) - plan.included_users),
    paidStorageGb: Math.max(0, Math.round((Number(base.entitlement.features['storage.limit_mb'] ?? 0) - plan.included_storage_mb) / MB_PER_GB)),
  }
}
/** A failed order attempt may still have been recorded when the answer never arrived (no status, or a server error): its idempotency key is then kept so a retry returns that order instead of placing a second one. A refusal (4xx) recorded nothing. */
export function orderOutcomeUnknown(cause: unknown): boolean {
  const { status } = commercialFailure(cause)
  return status === null || status >= 500
}
/** Preview body for POST commercial/customer-quotes: the server computes both sides; `terms` is an unsaved draft and `preview` prices the terms in force, nothing is persisted. A customer with no subscription yet (`view` null) is quoted as a new one at revision 0. */
export function customerQuoteBody(customerId: string, view: SubscriptionView | null, extra: { terms?: Omit<TermsPayload, 'customer_id' | 'reason'>; preview?: true; planRevisionId?: string; bundleIds?: string[]; cadence?: Cadence; extraBranches?: number; users?: number; storageMb?: number; onboarding?: true } = {}) {
  const base = view?.target ?? view?.applied
  if (!base) {
    if (!extra.planRevisionId || !extra.cadence || !extra.bundleIds) throw new Error('no_subscription')
    return {
      customer_id: customerId, kind: 'new' as const,
      ...(view ? { subscription_id: view.id } : {}), expected_subscription_revision: view?.revision ?? 0,
      plan_revision_id: extra.planRevisionId, bundle_revision_ids: extra.bundleIds,
      cadence: extra.cadence, requested_extra_branches: extra.extraBranches ?? 0,
      requested_users: extra.users ?? 0, requested_storage_mb: extra.storageMb ?? 0,
      ...(extra.onboarding ? { onboarding: true as const } : {}),
    }
  }
  return {
    customer_id: customerId, kind: 'change' as const, subscription_id: view!.id, expected_subscription_revision: view!.revision,
    plan_revision_id: extra.planRevisionId ?? base.plan_revision_id, bundle_revision_ids: extra.bundleIds ?? base.bundle_revision_ids,
    cadence: extra.cadence ?? base.cadence, requested_extra_branches: extra.extraBranches ?? base.extra_branch_count,
    requested_users: extra.users ?? Number(base.entitlement.features['users.limit'] ?? 0),
    requested_storage_mb: extra.storageMb ?? Number(base.entitlement.features['storage.limit_mb'] ?? 0),
    ...(extra.terms ? { terms: extra.terms } : {}),
    ...(extra.preview ? { preview: true as const } : {}),
  }
}
/** Server returns either `{quote, preview:true}` or a quote carrying `preview: true`. Previews are never persisted and can never be accepted. */
export function normalizeQuoteResponse<Q extends { id?: string }>(r: unknown): { quote: Q; preview: boolean } {
  const o = r as { quote?: Q; preview?: boolean } & Q
  if (o && typeof o === 'object' && o.quote && typeof o.quote === 'object') return { quote: o.quote, preview: o.preview === true || (o.quote as { preview?: boolean }).preview === true }
  return { quote: o as Q, preview: o?.preview === true }
}
/** A change request must use the customer's saved terms: strip any draft `terms`. */
export function withoutDraftTerms<T extends Record<string, unknown>>(body: T): Omit<T, 'terms'> { const { terms: _t, ...rest } = body; return rest }
export function termsOnly(p: TermsPayload): Omit<TermsPayload, 'customer_id' | 'reason'> { const { customer_id: _c, reason: _r, ...rest } = p; return rest }
export const SUPPORTED_CURRENCY = CURRENCY

/** Returns to the customer list, keeping only whitelisted filters. */
export function customersReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/customers')) return '/customers'
  try { const u = new URL(value, 'http://liwan.local'); return u.pathname.replace(/\/$/, '') === '/customers' ? `${u.pathname}${u.search}` : '/customers' } catch { return '/customers' }
}
/** A draft has no number and is never printed; every other invoice has the document the customer prints. */
export const invoicePrintable = (invoice: { status: string; number: string | null }): boolean => invoice.status !== 'draft' && invoice.number !== null

/** An invoice goes back to the invoice list or to the customer it was opened from (its invoices tab), never to another page or origin. */
export function invoicesReturnTo(value: unknown): string {
  return safeReturnTo(value, '/invoices', ['/invoices', '/customers'])
}

/** Cancellation errors remain actionable without displaying provider internals. */
export function cancellationErrorKey(cause: unknown): string {
  const code = commercialFailure(cause).code
  return ['order_not_cancellable', 'payment_reconciliation_required', 'provider_mismatch', 'reason_required'].includes(code)
    ? `vendor.customers.cancelOrder.errors.${code}` : commercialErrorKey(cause)
}

/** Renewal cancellation errors name the rule that refused them; anything else falls back to the shared message. */
export function renewalErrorKey(cause: unknown): string {
  const code = commercialFailure(cause).code
  return ['nothing_to_cancel', 'subscription_past_due', 'lock_pending', 'subscription_suspended', 'subscription_change_pending', 'cancel_trial_unsupported', 'cancel_already_effective'].includes(code)
    ? `vendor.customers.renewalCancel.errors.${code}` : commercialErrorKey(cause)
}

/** Removing the card or stopping automatic renewal: a card the provider could not delete stays on file, and a mismatched provider is refused; anything else falls back to the shared message. */
export function cardActionErrorKey(cause: unknown): string {
  const code = commercialFailure(cause).code
  return ['provider_unavailable', 'provider_mismatch'].includes(code) ? `vendor.customers.cardActions.errors.${code}` : commercialErrorKey(cause)
}

/** What changing the address on record did. */
export type AdminLoginChange = { admin_login: string; previous_admin_login: string | null; deletion_code_invalidated: boolean }
/** What a change would meet, without making it: other customers that already hold the address (nothing forbids it, but "find my workspace" lists all their workspaces to that mailbox). */
export type AdminLoginPreview = { other_customers_with_address: number }

/** Changing the address on record is refused for the same address, a customer with no workspace or a workspace nobody has activated; anything else falls back to the shared message. */
export function adminLoginErrorKey(cause: unknown): string {
  const code = commercialFailure(cause).code
  return ['admin_login_unchanged', 'no_workspace', 'workspace_not_activated'].includes(code) ? `vendor.customers.adminLogin.errors.${code}` : commercialErrorKey(cause)
}

/** Withdrawing a deletion request is refused once the deletion passed its point of no return; anything else falls back to the shared message. */
export function deletionErrorKey(cause: unknown): string {
  return commercialFailure(cause).code === 'deletion_in_progress' ? 'vendor.customers.deletion.errors.deletion_in_progress' : commercialErrorKey(cause)
}
