import { daysBetween, MAX_USERS, riyadhDate, type Invoice, type Money, type Order, type Quote, type SubscriptionDisplayState, type SubscriptionState, type SubscriptionView, type TrialEndPreview, type UsageMetric, type UsageSnapshot } from '@liwan/commercial-contracts'

import { invoiceLineQuantities, type InvoiceLineView } from '@liwan/commercial-ui/app/utils/invoiceLines'
import { humanizeId } from '@liwan/ui/app/utils/humanizeId'
import { statusBadgeEntry, type StatusBadgeEntry } from '@liwan/ui/app/utils/statusBadge'

export type { SubscriptionDisplayState }
export const DISPLAY_STATE_KEYS: Record<SubscriptionDisplayState, string> = {
  awaiting_payment: 'subscription.state.awaitingPayment', activating: 'subscription.state.activating',
  active: 'subscription.state.active', failed: 'subscription.state.failed', inactive: 'subscription.state.inactive',
}
const DISPLAY_STATE_TONES: Record<SubscriptionDisplayState, StatusBadgeEntry['tone']> = {
  awaiting_payment: 'warning', activating: 'info', active: 'success', failed: 'destructive', inactive: 'neutral',
}

export function subscriptionStateBadge(state: SubscriptionDisplayState): StatusBadgeEntry {
  return statusBadgeEntry(
    Object.fromEntries((Object.keys(DISPLAY_STATE_TONES) as SubscriptionDisplayState[]).map(key => [key, { tone: DISPLAY_STATE_TONES[key], labelKey: DISPLAY_STATE_KEYS[key] }])) as Record<SubscriptionDisplayState, StatusBadgeEntry>,
    state,
  )
}

export function formatSubscriptionMoney(money: Money, locale = 'ar'): string {
  const intl = locale.startsWith('ar') ? 'ar-SA-u-nu-latn' : 'en-US'
  return new Intl.NumberFormat(intl, { style: 'currency', currency: money.currency, minimumFractionDigits: money.exponent, maximumFractionDigits: money.exponent }).format(money.minor / 10 ** money.exponent)
}

/** A usage figure for display. `value: null` means unknown: never rendered as 0. */
export function usageFigure(metric: UsageMetric, freshness: UsageSnapshot['freshness']): { value: number | null; limit: number | null; known: boolean; stale: boolean } {
  const known = freshness !== 'unavailable' && metric.used !== null
  return { value: known ? metric.used : null, limit: metric.limit, known, stale: known && freshness === 'stale' }
}

/** The refusal code `createError({statusCode,data})` produces on the client: the body is nested one level. */
export function refusalCode(cause: unknown): string | null {
  const e = cause as { data?: { code?: string; data?: { code?: string } } } | null
  const code = e?.data?.data?.code ?? e?.data?.code
  return typeof code === 'string' ? code : null
}

/** Refusal codes that need a specific explanation; everything else falls back to the generic message. */
export function refusalKey(code: unknown): string | null {
  // Release 1: the server refuses a quote above MAX_USERS; the customer is told the cap and who to contact.
  if (code === 'users_limit_exceeded') return 'subscription.change.usersCapNote'
  if (code === 'storage_step_invalid') return 'subscription.change.storageStepInvalid'
  if (code === 'trial_ending' || code === 'lock_pending') return `subscription.trialEnd.details.${code}`
  return code === 'tenant_upgrade_required' || code === 'tenant_binding_unavailable' || code === 'trial_order_unavailable'
    ? `subscription.trial.${code === 'tenant_upgrade_required' ? 'upgradeRequired' : 'notConfigured'}`
    : null
}

/** The trial-end preview exists while a trial runs, after it settles, and during an unresolved lapse (trial_ends_at is already cleared then). */
export function hasTrialPreview(sub: SubscriptionView | null) {
  return Boolean(sub?.applied && (sub.trial_ends_at || sub.trial_outcome || sub.trial_lapse_pending))
}

export function trialEndActions(status: TrialEndPreview['status'] | null, state: SubscriptionState | null, canManage: boolean) {
  return {
    blocked: state === 'suspended' || status === 'trial_ending' || status === 'lock_pending',
    canConvert: canManage && state === 'trialing' && (status === null || status === 'trialing' || status === 'trial_ending'),
    canRetry: canManage && state !== 'suspended' && status === 'lock_pending',
  }
}

/** Old or unavailable catalog revisions have no display name. Keep their IDs out of customer-facing text. */
export function trialBundleNames(bundles: ReadonlyArray<Record<string, unknown>>): Record<string, string> {
  return Object.fromEntries(bundles.flatMap(bundle =>
    typeof bundle.id === 'string' && typeof bundle.name === 'string' ? [[bundle.id, bundle.name]] : [],
  ))
}

/** The commercial facts of a quote, ignoring its identity and expiry, so a re-quote of the
 * same selection compares equal even though `expires_at` moves the digest. */
export function quoteEconomics(q: Quote) {
  return {
    plan: q.plan_revision_id, bundles: [...q.bundle_revision_ids].sort(), terms: q.terms_revision_id,
    cadence: q.cadence, users: q.requested_users, storage: q.requested_storage_mb,
    branches: q.requested_extra_branches, due: q.due_now.minor, renewal: q.next_renewal.minor,
    lines: q.lines.map(l => [l.kind, l.key, l.amount.minor, l.quantity]),
  }
}

export function sameQuoteEconomics(a: Quote, b: Quote): boolean {
  return JSON.stringify(quoteEconomics(a)) === JSON.stringify(quoteEconomics(b))
}

/**
 * A11 (owner decision 2026-11-07): extra storage is bought in steps, and these are the only quantities the server quotes
 * (`fitsStorageSteps` in `@liwan/commercial-contracts`, which throws `CommercialError('storage_step_invalid')`).
 * Above `included_storage_mb`, an extra BELOW `storage_step_threshold_mb` must be a whole multiple of `storage_step_mb`;
 * at or above the threshold it must be a whole multiple of `storage_large_step_mb`. Zero extra is always legal.
 * With the seeded plan (20 GiB included, 10 GiB / 100 GiB threshold / 100 GiB large step) that is 20 GiB, 30 GiB …
 * 120 GiB of total storage, then 220 GiB, 320 GiB … — 130 GiB is refused. All three steps are vendor-editable plan
 * values, so the options are computed from the plan and never from constants.
 */
export const STORAGE_MB_PER_GB = 1024
/** The list caps at 20 options (with the seeds: 20 GiB, then 30 … 120 GiB, then 220 … 1,020 GiB) so a small step cannot build an unusable menu. */
export const STORAGE_OPTIONS_MAX = 20
export type StoragePlanValues = {
  included_storage_mb: number
  storage_step_mb: number
  storage_step_threshold_mb: number
  storage_large_step_mb: number
}
export type StorageOption = {
  /** The `requested_storage_mb` the page sends: the included amount plus the chosen extra. */
  storageMb: number
  extraMb: number
  totalGb: number
  extraGb: number
  /** The `storage_prices` amount for this cadence that `extraMb` costs, or null when the option carries no extra. */
  amount: Quote['due_now'] | null
}

/** Whole-GiB options only: the plan minimum itself must be whole GB, so a fractional total can never be sent. */
function wholeGb(mb: number): number | null {
  const gb = mb / STORAGE_MB_PER_GB
  return Number.isSafeInteger(gb) && gb >= 0 ? gb : null
}

/**
 * Every storage quantity the plan accepts, ascending, with the price of its extra storage.
 *
 * The list starts at `included_storage_mb` with no extra (zero is always legal), adds `storage_step_mb` while the extra is
 * below `storage_step_threshold_mb`, then adds `storage_large_step_mb`, and stops after `STORAGE_OPTIONS_MAX` options.
 * That cap follows the server rule (it never trims a legal step); quantities beyond the last row stay unbuyable from the
 * change page. `storage_prices` supplies the per-step amount for the cadence being quoted; a cadence without a storage
 * price yields `amount: null` (the unit price row is missing, so the option shows no price rather than zero).
 */
export function storageOptions(
  plan: Partial<StoragePlanValues>,
  prices: Array<{ cadence: { unit: string; count: number }; amount: Quote['due_now'] }> | undefined,
  cadence: { unit: string; count: number },
  max = STORAGE_OPTIONS_MAX,
): StorageOption[] {
  const included = wholeGb(plan.included_storage_mb ?? 0); const small = wholeGb(plan.storage_step_mb ?? 0)
  const threshold = wholeGb(plan.storage_step_threshold_mb ?? 0); const large = wholeGb(plan.storage_large_step_mb ?? 0)
  if (included === null || !small || threshold === null || !large) return []
  const unit = prices?.find(p => p.cadence.unit === cadence.unit && p.cadence.count === cadence.count)?.amount ?? null
  const options: StorageOption[] = [{ storageMb: included * STORAGE_MB_PER_GB, extraMb: 0, totalGb: included, extraGb: 0, amount: null }]
  let extraGb = 0
  while (options.length < Math.max(1, max)) {
    const step = extraGb < threshold ? small : large
    extraGb += step
    const totalGb = included + extraGb
    if (!Number.isSafeInteger(totalGb)) break
    // The option's own price: the unit price times the extra gigabytes it adds. `unit` is the price per GiB.
    options.push({ storageMb: totalGb * STORAGE_MB_PER_GB, extraMb: extraGb * STORAGE_MB_PER_GB, totalGb, extraGb,
      amount: unit ? { ...unit, minor: unit.minor * extraGb } : null })
  }
  return options
}

/** Brings a stored or server-provided quantity onto the option list: an accepted figure stays, anything else steps up
 * to the nearest option (so the page never submits a quantity the server would refuse). */
export function nearestStorageOption(options: StorageOption[], storageMb: number): StorageOption | null {
  if (!options.length) return null
  // An accepted figure stays; anything else steps UP to the nearest option. Never down: the fallback used to be the
  // largest option, which quietly reduced a customer who already had more than the list reaches.
  return options.find(o => o.storageMb >= storageMb) ?? null
}

/** The quantity the page keeps after the options change: the nearest option at or above it, and the quantity itself when it
 * is above the last option (a subscription that already holds more than the list reaches is never shrunk by the form). */
export function fitStorageMb(options: StorageOption[], storageMb: number): number {
  return nearestStorageOption(options, storageMb)?.storageMb ?? storageMb
}

/** True when the quantity is not one of the options, so the select cannot show it and the customer must contact us to change it. */
export function storageUnlisted(options: StorageOption[], storageMb: number): boolean {
  return options.length > 0 && !options.some(o => o.storageMb === storageMb)
}

/**
 * What the invoice page shows for the transfer section. One decision, taken from the outcome, so the page cannot render
 * an error where there is only an unconfigured account (or the reverse).
 */
export function transferNotice(outcome: BankTransferOutcome<BankTransferInstructionsLike>): 'none' | 'unavailable' | 'failed' {
  if (outcome.kind === 'failed') return 'failed'
  if (outcome.kind === 'unavailable') return 'unavailable'
  return 'none'
}

/** The release sells up to MAX_USERS; above it the customer is asked to contact us rather than being told "failed". */
export const usersOverCap = (users: number, max = MAX_USERS) => users > max

export const QUOTE_IS_EXPIRED = (quote: Pick<Quote, 'expires_at'>, now = Date.now()): boolean => Date.parse(quote.expires_at) <= now

/** Body for POST /quotes and /branch-quotes never carries tenant/customer identity (the BFF rejects those keys). */
export function sanitizeBody<T extends Record<string, unknown>>(body: T): T {
  const forbidden = new Set(['tenant_id', 'customer_id', 'capabilities', 'principal', 'actor_id'])
  return Object.fromEntries(Object.entries(body).filter(([k]) => !forbidden.has(k))) as T
}

/**
 * One idempotency key per user action, kept in sessionStorage so a retry or page refresh re-sends the same key
 * (the control plane then returns the original order instead of charging again). Call `forget` after the action settles.
 */
/**
 * The double-submit token for a mutation. When the page's first read ran during SSR its Set-Cookie never
 * reached the browser, so a missing cookie is requested once over the browser before the request is sent.
 */
export async function csrfTokenFor(current: string | null | undefined, fetchCookie: () => Promise<void>, read: () => string | null | undefined): Promise<string | null> {
  if (current) return current
  await fetchCookie()
  return read() ?? null
}

export type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export function idempotencyKey(store: KeyStore | null, action: string, make: () => string = () => crypto.randomUUID()): string {
  const name = `liwan:idem:${action}`
  const existing = store?.getItem(name)
  if (existing) return existing
  const fresh = make()
  store?.setItem(name, fresh)
  return fresh
}
export function forgetIdempotencyKey(store: KeyStore | null, action: string) { store?.removeItem(`liwan:idem:${action}`) }

/** Stable action name: same inputs (subscription, revision, request content) → same key across refresh/retry. */
export function safeIdemAction(kind: string, subscriptionId: string, revision: number, content: string): string {
  let h = 5381
  for (const ch of `${subscriptionId}|${revision}|${content}`) h = ((h << 5) + h + ch.charCodeAt(0)) | 0
  return `${kind}:${(h >>> 0).toString(36)}`
}

/** Provider redirect is followed only for https URLs (or the local simulator on same origin). */
export function safePaymentRedirect(url: string | null | undefined, origin: string): string | null {
  if (!url) return null
  try {
    const u = new URL(url, origin)
    if (u.protocol === 'https:' || u.origin === origin) return u.toString()
  } catch { /* fall through */ }
  return null
}

/** A usage row's label: its limit key's translation, else its unit's, else a readable id. */
export function usageMetricLabel(metric: Pick<UsageMetric, 'key' | 'unit'>, t: (key: string) => string, te: (key: string) => boolean): string {
  const byKey = `subscription.usage.keys.${metric.key.replace(/\./g, '_')}`
  if (te(byKey)) return t(byKey)
  const byUnit = `subscription.usage.${metric.unit}`
  if (te(byUnit)) return t(byUnit)
  return humanizeId(metric.key)
}

/** The customer invoice: list lines (× quantity · free · paid), the "not official" notice and the totals. */
export function subscriptionInvoiceView(invoice: Invoice, t: (key: string) => string, locale: string) {
  const money = (value: Invoice['total']) => formatSubscriptionMoney(value, locale)
  const lines: InvoiceLineView[] = invoice.lines.map((line) => {
    const q = invoiceLineQuantities(line)
    return {
      id: line.key,
      // Metered quantities are UI labels, not stored descriptions; the priced revision names the rest.
      description: line.kind === 'users' ? t('subscription.invoices.users') : line.kind === 'storage' ? t('subscription.invoices.storage') : line.description,
      cells: [
        { key: 'quantity', label: '', value: `× ${line.quantity}` },
        ...(q.free === null ? [] : [
          { key: 'free', label: t('subscription.invoices.free'), value: String(q.free) },
          { key: 'paid', label: t('subscription.invoices.paidQty'), value: String(q.paid) },
        ]),
      ],
      amount: money(line.amount),
    }
  })
  return {
    lines,
    notice: t('subscription.invoices.notOfficial'),
    totals: [
      { label: t('subscription.invoices.subtotal'), value: money(invoice.subtotal) },
      // Liwan is not VAT-registered (owner decision 2026-11-06): an untaxed invoice shows no tax row at all.
      ...(invoice.tax_label === null ? [] : [{ label: t('subscription.invoices.tax'), value: money(invoice.tax) }]),
      { label: t('subscription.invoices.total'), value: money(invoice.total) },
    ],
  }
}

export type OrderOutcome = 'applied' | 'cancelled' | 'awaiting_payment' | 'payment_failed' | 'processing' | 'recovering' | 'activation_failed' | 'refund'

/** What the customer should see for an order, whether it is still open or already closed. */
export function orderOutcome(order: Pick<Order, 'payment_state' | 'fulfillment_state'> & { cancelled?: boolean }): OrderOutcome {
  // A refund can follow activation and leaves fulfillment_state as it was, so the payment outcome wins.
  if (order.payment_state === 'refund_pending' || order.payment_state === 'refunded') return 'refund'
  if (order.fulfillment_state === 'applied') return 'applied'
  if (order.fulfillment_state === 'failed' || order.fulfillment_state === 'needs_intervention') {
    return order.payment_state === 'paid' && !order.cancelled ? 'recovering' : 'activation_failed'
  }
  if (order.cancelled) return 'cancelled'
  if (order.payment_state === 'failed') return 'payment_failed'
  if (order.payment_state === 'awaiting_payment') return 'awaiting_payment'
  return 'processing'
}

/** Whole Riyadh calendar days left until `endsAt`, never below zero. */
export function trialDaysRemaining(endsAt: string | null | undefined, now: Date = new Date()): number | null {
  return endsAt ? Math.max(0, daysBetween(riyadhDate(now), riyadhDate(endsAt))) : null
}

/** The invoice page asks for bank-transfer instructions only for a permitted reader of an invoice that is still `issued`. */
export function invoiceWantsTransfer(allowed: boolean, invoice: { status: string } | null | undefined): boolean {
  return allowed && invoice?.status === 'issued'
}

/**
 * Which of the three bank-transfer answers the invoice page shows. The control plane answers 409 `bank_account_unavailable`
 * until the vendor fills the bank account in: that is "not configured" (the unavailable note), never an error. Any other
 * refusal is a real failure the customer must see, and is never swallowed.
 */
export interface BankTransferInstructionsLike {
  reference: string
  amount_minor: number
  currency: string
  exponent: number
  bank: { account_name: string; account_number: string; iban: string; instructions_ar: string; instructions_en: string }
}
export type BankTransferOutcome<T extends BankTransferInstructionsLike> =
  | { kind: 'not_requested' }
  | { kind: 'unavailable' }
  | { kind: 'failed'; cause: unknown }
  | { kind: 'instructions'; instructions: T }

/** `cause` is absent when the request resolved: then `instructions` is what it answered, or null when it answered nothing. */
export function bankTransferOutcome<T extends BankTransferInstructionsLike>(wanted: boolean, result: { instructions?: T | null; cause?: unknown }): BankTransferOutcome<T> {
  if (!wanted) return { kind: 'not_requested' }
  if (result.cause !== undefined) return refusalCode(result.cause) === 'bank_account_unavailable' ? { kind: 'unavailable' } : { kind: 'failed', cause: result.cause }
  return result.instructions ? { kind: 'instructions', instructions: result.instructions } : { kind: 'unavailable' }
}

/**
 * Keeps only the answer to the newest request: every `next()` supersedes the earlier tickets, so a slow response for an
 * earlier selection is dropped instead of replacing the one the customer is looking at.
 */
export function latestOnly() {
  let latest = 0
  return { next: () => ++latest, isCurrent: (ticket: number) => ticket === latest, cancel: () => { latest++ } }
}
