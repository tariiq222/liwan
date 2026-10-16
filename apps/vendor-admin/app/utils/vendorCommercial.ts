import {
  bundleCreateSchema, bundleEditSchema, planCreateSchema, planEditSchema, lifecycleActionSchema,
  type Audience, type BundleRevision, type BundleView, type CapacityMap, type CatalogApplication, type CatalogRelease, type CatalogReleaseView, type PlanView,
  type PricingPolicy, type Cadence, type Money, type PlanRevision, type Price, type Selection,
} from '@webvue/commercial-contracts'
import { safeReturnTo } from '@webvue/ui/app/utils/safeReturnTo'
import type { StatusBadgeEntry } from '@webvue/ui/app/utils/statusBadge'

export const CURRENCY = 'SAR'
export const EXPONENT = 2
export const MAX_LIMIT = Number.MAX_SAFE_INTEGER
/** Platform limits are owned by the plan, never by a bundle. */
export const PLATFORM_LIMIT_KEYS = ['users.limit', 'storage.limit_mb'] as const
export const PLATFORM_ONLY_FEATURES = new Set(['branches.extra_limit', ...PLATFORM_LIMIT_KEYS])

// ---- View types come from the server contract (bundleViewSchema / planViewSchema / catalogReleaseViewSchema) ----
export type { BundleView, PlanView, CatalogReleaseView, CommercialIssue as ViewIssue, PricingPolicy } from '@webvue/commercial-contracts'
export type VendorListEnvelope<T> = { items: T[]; total: number }
export type LifecycleStatus = 'draft' | 'validated' | 'published' | 'withdrawn'
export type LifecycleAction = 'validate' | 'publish' | 'withdraw' | 'restore' | 'revisions' | 'delete'
export type StatusFilter = LifecycleStatus | 'all'
export const STATUS_FILTERS: StatusFilter[] = ['all', 'draft', 'validated', 'published', 'withdrawn']

export function lifecycleStatus(view: { status: string; available: boolean }): LifecycleStatus {
  if (view.status === 'published') return view.available ? 'published' : 'withdrawn'
  return view.status === 'validated' ? 'validated' : 'draft'
}

const LIFECYCLE_TONE = { draft: 'neutral', validated: 'info', published: 'success', withdrawn: 'warning' } as const satisfies Record<LifecycleStatus, StatusBadgeEntry['tone']>

export function lifecycleBadge(view: { status: string; available?: boolean }): StatusBadgeEntry {
  const state = lifecycleStatus({ status: view.status, available: view.available ?? true })
  return { tone: LIFECYCLE_TONE[state], labelKey: `vendor.pricing.status.${state}` }
}
export function isStatusFilter(value: unknown): value is StatusFilter { return typeof value === 'string' && (STATUS_FILTERS as string[]).includes(value) }

// ---- Money ----
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
export function normalizeDigits(value: string): string {
  return value.replace(/[٠-٩]/g, d => String(ARABIC_DIGITS.indexOf(d))).replace(/٫/g, '.').replace(/[٬,\s]/g, '')
}
/** "12.5" → 1250. Returns null for blank/negative/too many decimals/non-numeric; never coerces blank to 0. */
export function parseVendorMoneyInput(value: string, exponent = EXPONENT): number | null {
  const text = normalizeDigits(value.trim())
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text)
  if (!match) return null
  const fraction = match[2] ?? ''
  if (fraction.length > exponent) return null
  const minor = Number(match[1]) * 10 ** exponent + Number(fraction.padEnd(exponent, '0') || 0)
  return Number.isSafeInteger(minor) ? minor : null
}
export function minorToInput(minor: number, exponent = EXPONENT): string { return (minor / 10 ** exponent).toFixed(exponent) }
export const sar = (minor: number): Money => ({ currency: CURRENCY, exponent: EXPONENT, minor })

// ---- Cadence ----
export const cadenceKey = (c: Cadence) => `${c.unit}:${c.count}`

// ---- Limits (tri-state: explicit unlimited / none(0) / number; blank is never 0) ----
export type LimitMode = '' | 'unlimited' | 'none' | 'number'
export type LimitDraft = { mode: LimitMode; value: string }
export const emptyLimit = (): LimitDraft => ({ mode: '', value: '' })
export function limitFromDraft(draft: LimitDraft | undefined): number | null {
  if (!draft) throw new Error('invalid_limit')
  if (draft.mode === 'unlimited') return null
  if (draft.mode === 'none') return 0
  const text = normalizeDigits(draft.value.trim())
  if (draft.mode !== 'number' || !/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < 1) throw new Error('invalid_limit')
  return Number(text)
}
export function limitToDraft(value: number | null | undefined): LimitDraft {
  if (value === undefined) return emptyLimit()
  if (value === null) return { mode: 'unlimited', value: '' }
  return value === 0 ? { mode: 'none', value: '' } : { mode: 'number', value: String(value) }
}
export function limitLabel(value: number | null | undefined, t: (key: string) => string): string {
  if (value === undefined) return t('vendor.pricing.limit.unset')
  return value === null ? t('vendor.pricing.limit.unlimited') : value === 0 ? t('vendor.pricing.limit.none') : String(value)
}
export function limitsFromDrafts(drafts: Record<string, LimitDraft>, keys: string[]): CapacityMap {
  return Object.fromEntries(keys.map(key => [key, limitFromDraft(drafts[key])]))
}
/** Whole-number field (>=0) that must be chosen explicitly. */
export function parseCount(value: string, max = MAX_LIMIT): number | null {
  const text = normalizeDigits(value.trim())
  return /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) && Number(text) <= max ? Number(text) : null
}

// ---- Prices ----
export type PriceDraft = { unit: '' | 'month' | 'year'; count: string; amount: string }
export const emptyPrice = (): PriceDraft => ({ unit: '', count: '1', amount: '' })
export const priceToDraft = (p: Price): PriceDraft => ({ unit: p.cadence.unit, count: String(p.cadence.count), amount: minorToInput(p.amount.minor, p.amount.exponent) })
/** Returns per-row error code or null; a row is valid only with unit, count 1-12, a parsed amount and a unique cadence. */
export function priceRowErrors(drafts: PriceDraft[]): (string | null)[] {
  const seen = new Set<string>()
  return drafts.map(row => {
    const count = parseCount(row.count, 12)
    if (!row.unit || count === null || count < 1) return 'cadence'
    if (parseVendorMoneyInput(row.amount) === null) return 'amount'
    const key = `${row.unit}:${count}`
    if (seen.has(key)) return 'duplicate'
    seen.add(key)
    return null
  })
}
export function pricesFromDrafts(drafts: PriceDraft[]): Price[] {
  if (priceRowErrors(drafts).some(Boolean)) throw new Error('invalid_price')
  return drafts.map(row => ({ cadence: { unit: row.unit as 'month' | 'year', count: Number(normalizeDigits(row.count)) }, amount: sar(parseVendorMoneyInput(row.amount) as number) }))
}

// ---- Catalog helpers ----
export const appName = (app: CatalogApplication, locale: string) => (locale.startsWith('ar') ? app.name_ar : app.name_en)
export function bundleLimitKeys(release: CatalogRelease | undefined, selectedAppIds: string[]): string[] {
  const keys = new Set<string>()
  for (const app of release?.applications ?? []) if (selectedAppIds.includes(app.id)) for (const f of app.features) if (f.kind === 'limit' && !PLATFORM_ONLY_FEATURES.has(f.key)) keys.add(f.key)
  return [...keys].sort()
}
export type DependencyHints = { missing: { app: string; requires: string }[]; conflicts: { app: string; with: string }[] }
export function dependencyHints(release: CatalogRelease | undefined, selectedAppIds: string[]): DependencyHints {
  const hints: DependencyHints = { missing: [], conflicts: [] }
  if (!release) return hints
  const core = release.applications.filter(a => !a.selectable).map(a => a.id)
  const available = new Set([...selectedAppIds, ...core])
  for (const app of release.applications.filter(a => selectedAppIds.includes(a.id))) {
    for (const dep of app.requires_apps) if (!available.has(dep)) hints.missing.push({ app: app.id, requires: dep })
    for (const other of app.conflicts_with_apps) if (selectedAppIds.includes(other) && app.id < other) hints.conflicts.push({ app: app.id, with: other })
  }
  return hints
}

// ---- Audience ----
export type AudienceDraft = { kind: 'public' | 'customer'; customer_id: string }
export const audienceToDraft = (a: Audience): AudienceDraft => ({ kind: a.kind, customer_id: a.kind === 'customer' ? a.customer_id : '' })
export function audienceFromDraft(d: AudienceDraft): Audience {
  if (d.kind === 'public') return { kind: 'public' }
  const id = d.customer_id.trim()
  if (!id) throw new Error('invalid_audience')
  return { kind: 'customer', customer_id: id }
}

// ---- Bundle form ↔ payload ----
export type BundleDraft = {
  name: string; description: string; audience: AudienceDraft; catalog_release_id: string
  apps: Record<string, { selected: boolean; features: string[] }>; limits: Record<string, LimitDraft>; prices: PriceDraft[]; reason: string
}
export function emptyBundleDraft(): BundleDraft {
  return { name: '', description: '', audience: { kind: 'public', customer_id: '' }, catalog_release_id: '', apps: {}, limits: {}, prices: [], reason: '' }
}
export function bundleDraftFromView(view: BundleRevision): BundleDraft {
  return {
    name: view.name, description: view.description, audience: audienceToDraft(view.audience), catalog_release_id: view.catalog_release_id,
    apps: Object.fromEntries(view.selections.map(s => [s.app_id, { selected: true, features: [...s.feature_keys] }])),
    limits: Object.fromEntries(Object.entries(view.domain_limits).map(([k, v]) => [k, limitToDraft(v)])),
    prices: view.prices.map(priceToDraft), reason: '',
  }
}
export function selectionsFromDraft(draft: BundleDraft): Selection[] {
  return Object.entries(draft.apps).filter(([, v]) => v.selected).map(([app_id, v]) => ({ app_id, feature_keys: [...v.features].sort() })).sort((a, b) => a.app_id.localeCompare(b.app_id))
}
export function bundleFields(draft: BundleDraft, release: CatalogRelease | undefined) {
  const selections = selectionsFromDraft(draft)
  return {
    name: draft.name.trim(), description: draft.description.trim(), audience: audienceFromDraft(draft.audience),
    catalog_release_id: draft.catalog_release_id, selections,
    domain_limits: limitsFromDrafts(draft.limits, bundleLimitKeys(release, selections.map(s => s.app_id))),
    prices: pricesFromDrafts(draft.prices),
  }
}
export function bundleCreatePayload(draft: BundleDraft, release: CatalogRelease | undefined) {
  return bundleCreateSchema.parse({ ...bundleFields(draft, release), ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}) })
}
export function bundleEditPayload(draft: BundleDraft, release: CatalogRelease | undefined, editRevision: number) {
  return bundleEditSchema.parse({ ...bundleFields(draft, release), edit_revision: editRevision, reason: draft.reason.trim() })
}

// ---- Plan form ↔ payload ----
export type Tri = '' | 'true' | 'false'
export type PlanDraft = {
  name: string; audience: AudienceDraft; term_months: string; prices: PriceDraft[]
  included: string[]; optional: string[]; platform: Record<string, LimitDraft>
  included_extra_branches: string; extra_branch_prices: PriceDraft[]; extra_branches_limit: LimitDraft
  trial_days: string; grace_days: string; auto_suspend: Tri; auto_renew_allowed: Tri; reason: string
}
export function emptyPlanDraft(): PlanDraft {
  return {
    name: '', audience: { kind: 'public', customer_id: '' }, term_months: '', prices: [], included: [], optional: [],
    platform: Object.fromEntries(PLATFORM_LIMIT_KEYS.map(k => [k, emptyLimit()])), included_extra_branches: '', extra_branch_prices: [],
    extra_branches_limit: emptyLimit(), trial_days: '', grace_days: '', auto_suspend: '', auto_renew_allowed: '', reason: '',
  }
}
const triOf = (v: boolean): Tri => (v ? 'true' : 'false')
export function planDraftFromView(v: PlanRevision): PlanDraft {
  return {
    name: v.name, audience: audienceToDraft(v.audience), term_months: String(v.term_months), prices: v.prices.map(priceToDraft),
    included: [...v.included_bundle_revision_ids], optional: [...v.optional_bundle_revision_ids],
    platform: { ...Object.fromEntries(PLATFORM_LIMIT_KEYS.map(k => [k, limitToDraft(v.platform_limits[k])])) },
    included_extra_branches: String(v.included_extra_branches), extra_branch_prices: v.extra_branch_prices.map(priceToDraft),
    extra_branches_limit: limitToDraft(v.extra_branches_limit), trial_days: String(v.trial_days), grace_days: String(v.grace_days),
    auto_suspend: triOf(v.auto_suspend), auto_renew_allowed: triOf(v.auto_renew_allowed), reason: '',
  }
}
function triValue(v: Tri): boolean { if (!v) throw new Error('invalid_choice'); return v === 'true' }
function requireCount(v: string, max = MAX_LIMIT): number { const n = parseCount(v, max); if (n === null) throw new Error('invalid_count'); return n }
export function planFields(draft: PlanDraft, policyId: string) {
  return {
    name: draft.name.trim(), audience: audienceFromDraft(draft.audience), term_months: requireCount(draft.term_months, 120), currency: CURRENCY,
    prices: pricesFromDrafts(draft.prices), platform_limits: limitsFromDrafts(draft.platform, [...PLATFORM_LIMIT_KEYS]),
    included_bundle_revision_ids: [...draft.included], optional_bundle_revision_ids: draft.optional.filter(id => !draft.included.includes(id)),
    included_extra_branches: requireCount(draft.included_extra_branches), extra_branch_prices: pricesFromDrafts(draft.extra_branch_prices),
    extra_branches_limit: limitFromDraft(draft.extra_branches_limit), policy_revision_id: policyId,
    trial_days: requireCount(draft.trial_days, 3650), grace_days: requireCount(draft.grace_days, 3650),
    auto_suspend: triValue(draft.auto_suspend), auto_renew_allowed: triValue(draft.auto_renew_allowed),
  }
}
export function planCreatePayload(draft: PlanDraft, policyId: string) {
  return planCreateSchema.parse({ ...planFields(draft, policyId), ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}) })
}
export function planEditPayload(draft: PlanDraft, policyId: string, editRevision: number) {
  return planEditSchema.parse({ ...planFields(draft, policyId), edit_revision: editRevision, reason: draft.reason.trim() })
}

// ---- Lifecycle ----
export type CommercialKind = 'bundle' | 'plan'
export type VendorCan = (capability: 'vendor.catalog.manage' | 'vendor.pricing.manage') => boolean
export function availableActions(status: LifecycleStatus): LifecycleAction[] {
  if (status === 'draft') return ['validate', 'delete']
  if (status === 'validated') return ['publish']
  return status === 'published' ? ['revisions', 'withdraw'] : ['revisions', 'restore']
}
const PRICING_BUNDLE_ACTIONS: LifecycleAction[] = ['publish', 'withdraw', 'restore']
/** Reason a user cannot run an action, or null. Plans need both capabilities for everything; bundles need pricing for publish/withdraw/restore (server http.ts). */
export function actionBlockedReason(kind: CommercialKind, action: LifecycleAction, can: VendorCan): 'catalog' | 'pricing' | null {
  if (!can('vendor.catalog.manage')) return 'catalog'
  if ((kind === 'plan' || PRICING_BUNDLE_ACTIONS.includes(action)) && !can('vendor.pricing.manage')) return 'pricing'
  return null
}
/** Bundle prices live in the form, so saving a bundle with prices needs pricing authority as well. */
export function canEditDraft(can: VendorCan): boolean { return can('vendor.catalog.manage') && can('vendor.pricing.manage') }
export function lifecycleBody(editRevision: number, reason: string) { return lifecycleActionSchema.parse({ edit_revision: editRevision, reason: reason.trim() }) }
export function lifecycleUrl(kind: CommercialKind, id: string, action: LifecycleAction): { path: string; method: 'POST' | 'DELETE' } {
  const base = `commercial/${kind === 'bundle' ? 'bundles' : 'plans'}/${encodeURIComponent(id)}`
  return action === 'delete' ? { path: base, method: 'DELETE' } : { path: `${base}/${action}`, method: 'POST' }
}

// ---- Errors ----
export type CommercialFailure = { status: number | null; code: string; message: string; field?: string; conflict: boolean; forbidden: boolean }
export function commercialFailure(cause: unknown): CommercialFailure {
  const e = cause as { status?: number; statusCode?: number; code?: string; message?: string; field?: string; data?: { code?: string; message?: string; field?: string; data?: { code?: string; message?: string; field?: string } }; response?: { status?: number; _data?: { code?: string; message?: string; field?: string } } } | null
  const body = e?.data?.data ?? e?.data ?? e?.response?._data
  const status = e?.status ?? e?.statusCode ?? e?.response?.status ?? null
  const code = body?.code ?? e?.code ?? 'unknown'
  return { status, code, message: body?.message ?? e?.message ?? '', field: body?.field ?? e?.field, conflict: status === 409 || code === 'revision_conflict', forbidden: status === 403 || code === 'forbidden' }
}
/** Every code the control-plane commercial routes, the contract compiler and the vendor proxy can emit; each needs vendor.pricing.errors.<code> in ar and en. */
export const COMMERCIAL_ERROR_CODES = ['revision_conflict', 'invalid', 'forbidden', 'not_found', 'transition_forbidden', 'transition_invalid', 'customers_attached', 'price_missing', 'feature_not_selectable', 'dependency_missing', 'app_conflict', 'dependency_cycle', 'unknown_app', 'app_not_selectable', 'catalog_release_mismatch', 'bundle_not_allowed', 'bundle_missing', 'bundle_unavailable', 'bundle_duplicated', 'bundle_delete_forbidden', 'bundle_audience_mismatch', 'plan_missing', 'plan_unavailable', 'plan_delete_forbidden', 'policy_missing', 'release_missing', 'published_catalog_missing', 'quote_missing', 'quote_kind_unsupported', 'terms_unsupported', 'content_digest_mismatch', 'review_required', 'audience_invalid', 'branch_limit_invalid', 'branch_limit_exceeded', 'branch_price_missing', 'currency_mismatch', 'duplicate_price_cadence', 'term_not_multiple', 'ambiguous_limit', 'limit_not_supported', 'invalid_limit_scope', 'invalid_quantity', 'invalid_billing_period', 'invalid_order_transition', 'invalid_json', 'payload_too_large', 'unauthorized', 'vendor_unavailable', 'method_not_allowed'] as const
const KNOWN_ERRORS = new Set<string>(COMMERCIAL_ERROR_CODES)
export function commercialErrorKey(cause: unknown): string {
  const f = commercialFailure(cause)
  return KNOWN_ERRORS.has(f.code) ? `vendor.pricing.errors.${f.code}` : 'vendor.pricing.errors.generic'
}
/** Field-scoped server issue for a form field name (matches exact name or `name.` / `name[` prefix). */
export function fieldIssue(failure: CommercialFailure | null, field: string): string | undefined {
  if (!failure?.field) return undefined
  return failure.field === field || failure.field.startsWith(`${field}.`) || failure.field.startsWith(`${field}[`) ? failure.code : undefined
}

// ---- Routing ----
export function commercialReturnTo(value: unknown, root: '/bundles' | '/plans'): string {
  const safe = safeReturnTo(value, root, [root])
  return new URL(safe, 'http://webvue.local').pathname.replace(/\/$/, '') === root ? safe : root
}

// ---- Summaries ----
export function summaryLimits(view: { domain_limits?: CapacityMap; platform_limits?: CapacityMap }): [string, number | null][] {
  return Object.entries({ ...(view.platform_limits ?? {}), ...(view.domain_limits ?? {}) }).sort(([a], [b]) => a.localeCompare(b))
}
export type QuoteInput = { plan: PlanRevision | PlanView; cadence: Cadence; extraBranches: number; optionalBundleIds: string[] }
export function quoteRequestBody(input: QuoteInput) {
  return { kind: 'new' as const, plan_revision_id: input.plan.id, bundle_revision_ids: [...input.plan.included_bundle_revision_ids, ...input.optionalBundleIds], cadence: input.cadence, requested_extra_branches: input.extraBranches }
}

export function keyLabel(key: string, t: (key: string) => string, te: (key: string) => boolean): string {
  const path = `vendor.pricing.keys.${key.replace(/\./g, '_')}`
  return te(path) ? t(path) : key
}
