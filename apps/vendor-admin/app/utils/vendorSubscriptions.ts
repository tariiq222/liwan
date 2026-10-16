import type { StatusBadgeEntry } from '@nasq/ui/app/utils/statusBadge'
import { subscriptionDisplayState, type Cadence, type Invoice, type InvoiceLine, type Money, type Order, type SubscriptionDisplayState, type SubscriptionView, type UsageMetric } from '@nasq/commercial-contracts'
import { commercialErrorKey, commercialFailure, CURRENCY, emptyLimit, limitFromDraft, parseCount, parseVendorMoneyInput, sar, type LimitDraft } from './vendorCommercial'
import { formatCommercialMoney } from '@nasq/commercial-ui/app/utils/commercial'
import { humanizeId } from '@nasq/ui/app/utils/humanizeId'
import { invoiceLineQuantities, type InvoiceLineView } from '@nasq/commercial-ui/app/utils/invoiceLines'

export { subscriptionDisplayState }
export type VendorCustomer = { id: string; name: string; tenant_id: string | null; commercial_setup_required: boolean; subscription: SubscriptionView | null }
export type VendorCustomerList = { items: VendorCustomer[]; total: number }
/** Vendor invoice views carry the customer's name (joined server-side); the customer-facing invoice contract does not. */
export type VendorInvoice = Invoice & { customer_name: string }
export type VendorInvoiceList = { items: VendorInvoice[]; total: number; summary: { outstanding: Money[]; overdue_count: number } }

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
  if (o.fulfillment_state === 'failed' || o.fulfillment_state === 'needs_intervention' || o.payment_state === 'failed' || o.payment_state === 'refund_pending') return 'error' as const
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

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']; let v = bytes / 1024; let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`
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
export const isCreditRelated = (i: Pick<Invoice, 'status' | 'kind'>) => i.status === 'credit_pending' || i.kind === 'adjustment'

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
  extraBranchesLimit: LimitDraft; users: LimitDraft; storage: LimitDraft; termMonths: string; reason: string
}
export const emptyTermsDraft = (): TermsDraft => ({
  basePrice: '', baseUnit: '', baseCount: '1', includedExtraBranches: '', extraBranchPrice: '', extraBranchUnit: '', extraBranchCount: '1',
  extraBranchesLimit: emptyLimit(), users: emptyLimit(), storage: emptyLimit(), termMonths: '', reason: '',
})
export type TermsPayload = {
  customer_id: string; reason: string; base_price?: { cadence: Cadence; amount: ReturnType<typeof sar> }
  included_extra_branches?: number; extra_branch_price?: { cadence: Cadence; amount: ReturnType<typeof sar> }
  extra_branches_limit?: number | null; limits?: Record<string, number | null>; term_months?: number
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
  const limits: Record<string, number | null> = {}
  if (touched(d.users)) limits['users.limit'] = limitFromDraft(d.users)
  if (touched(d.storage)) limits['storage.limit_mb'] = limitFromDraft(d.storage)
  if (Object.keys(limits).length) out.limits = limits
  if (d.termMonths.trim()) { const n = parseCount(d.termMonths, 120); if (n === null || n < 1) throw new Error('invalid_count'); out.term_months = n }
  if (Object.keys(out).length <= 2 || out.reason.length < 3) throw new Error('invalid_terms')
  return out
}
export function hasTermsOverride(d: TermsDraft): boolean {
  try { termsPayload('x', { ...d, reason: d.reason.trim().length >= 3 ? d.reason : 'xxx' }); return true } catch { return false }
}
/** Preview body for POST commercial/customer-quotes: the server computes both sides; `terms` is an unsaved draft, nothing is persisted. */
export function customerQuoteBody(customerId: string, view: SubscriptionView, extra: { terms?: Omit<TermsPayload, 'customer_id' | 'reason'>; planRevisionId?: string; bundleIds?: string[]; cadence?: Cadence; extraBranches?: number } = {}) {
  const base = view.target ?? view.applied
  if (!base) {
    if (!extra.planRevisionId || !extra.cadence || !extra.bundleIds) throw new Error('no_subscription')
    return {
      customer_id: customerId, kind: 'new' as const, subscription_id: view.id, expected_subscription_revision: view.revision,
      plan_revision_id: extra.planRevisionId, bundle_revision_ids: extra.bundleIds,
      cadence: extra.cadence, requested_extra_branches: extra.extraBranches ?? 0,
    }
  }
  return {
    customer_id: customerId, kind: 'change' as const, subscription_id: view.id, expected_subscription_revision: view.revision,
    plan_revision_id: extra.planRevisionId ?? base.plan_revision_id, bundle_revision_ids: extra.bundleIds ?? base.bundle_revision_ids,
    cadence: extra.cadence ?? base.cadence, requested_extra_branches: extra.extraBranches ?? base.extra_branch_count,
    ...(extra.terms ? { terms: extra.terms } : {}),
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
  try { const u = new URL(value, 'http://nasq.local'); return u.pathname.replace(/\/$/, '') === '/customers' ? `${u.pathname}${u.search}` : '/customers' } catch { return '/customers' }
}
export function invoicesReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/invoices')) return '/invoices'
  try { const u = new URL(value, 'http://nasq.local'); return u.pathname.replace(/\/$/, '') === '/invoices' ? `${u.pathname}${u.search}` : '/invoices' } catch { return '/invoices' }
}

/** Cancellation errors remain actionable without displaying provider internals. */
export function cancellationErrorKey(cause: unknown): string {
  const code = commercialFailure(cause).code
  return ['order_not_cancellable', 'payment_reconciliation_required', 'provider_mismatch', 'reason_required'].includes(code)
    ? `vendor.customers.cancelOrder.errors.${code}` : commercialErrorKey(cause)
}

/** Issued and past its due date; the server's overdue count uses the same rule. */
export const isOverdue = (i: Pick<Invoice, 'status' | 'due_at'>, now = Date.now()) => i.status === 'issued' && i.due_at !== null && Date.parse(i.due_at) < now
