import { PROJECT_STATUSES, type ActualAccount, type ActualSource, type FinanceEntry, type FinanceEntryCreate, type FinanceEntryPatch, type FinanceKind, type ProjectStatus } from '@webvue/contracts'
import { ApiError } from '../composables/useApi'
import { canonicalFromMinor, parseMoneyInput } from './moneyInput'
import { parseOffset } from './routeQuery'

export const FINANCE_PAGE = 50

export type FinanceKindFilter = 'all' | FinanceKind
export type FinanceListRouteState = {
  kind: FinanceKindFilter
  q: string
  offset: number
}

export type ProjectReportStatusFilter = 'all' | 'unset' | ProjectStatus

export type FinanceCurrency = {
  id: number
  name: string
  symbol: string
  decimal_places: number
}

export type FinanceDraft = {
  kind: FinanceKind
  title: string
  amountInput: string
  expenseDate: string | null
  reference: string
  notes: string
  budgetEntryId: number | null
}

export type FinanceEntryLike = Pick<
  FinanceEntry,
  'id' | 'project_id' | 'kind' | 'title' | 'amount' | 'expense_date' | 'reference' | 'notes' | 'budget_entry_id' | 'updated_at'
>

export type FinanceFieldKey = 'title' | 'amount' | 'expense_date' | 'reference' | 'notes' | 'budget_entry_id' | 'kind'
type FinanceFieldError = { field: FinanceFieldKey; code: string }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const TITLE_MAX = 200
const REFERENCE_MAX = 200
const NOTES_MAX = 10000

// Unlike the shared `firstQuery`, this does not unwrap a repeated `?q=`
// query param into its first value — a caller that ever sent one would see
// an empty search rather than the array's first entry, which is the
// established behaviour here and is left unchanged.
function firstQueryString(value: unknown): string {
  if (typeof value === 'string') return value
  return ''
}

export function parseFinanceKind(value: unknown): FinanceKindFilter {
  if (value === 'budget' || value === 'expense') return value
  return 'all'
}

export function parseFinanceListRoute(query: Record<string, unknown>): FinanceListRouteState {
  return {
    kind: parseFinanceKind(query.kind),
    q: firstQueryString(query.q),
    offset: parseOffset(query.offset),
  }
}

export function serializeFinanceListRoute(state: FinanceListRouteState) {
  return {
    kind: state.kind === 'all' ? undefined : state.kind,
    q: state.q.trim() || undefined,
    offset: state.offset || undefined,
  }
}

export function patchFinanceListRoute(
  current: FinanceListRouteState,
  patch: Partial<FinanceListRouteState>,
): FinanceListRouteState {
  const next: FinanceListRouteState = {
    kind: patch.kind ?? current.kind,
    q: patch.q ?? current.q,
    offset: patch.offset ?? current.offset,
  }
  if (patch.offset === undefined && (patch.q !== undefined || patch.kind !== undefined)) {
    next.offset = 0
  }
  return {
    kind: parseFinanceKind(next.kind),
    q: next.q,
    offset: parseOffset(next.offset),
  }
}

export function sameFinanceListRoute(
  left: ReturnType<typeof serializeFinanceListRoute>,
  right: ReturnType<typeof serializeFinanceListRoute>,
) {
  return left.kind === right.kind && left.q === right.q && left.offset === right.offset
}

export function financeListQuery(filters: {
  kind?: FinanceKindFilter
  q?: string
  limit?: number
  offset?: number
}) {
  const rawLimit = filters.limit ?? FINANCE_PAGE
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : FINANCE_PAGE
  const rawOffset = filters.offset ?? 0
  const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0
  return {
    kind: filters.kind === 'budget' || filters.kind === 'expense' ? filters.kind : undefined,
    q: filters.q?.trim() || undefined,
    limit,
    offset,
  }
}

export function parseReportStatus(value: unknown): ProjectReportStatusFilter {
  if (value === 'unset') return 'unset'
  if (typeof value === 'string' && (PROJECT_STATUSES as readonly string[]).includes(value)) return value as ProjectStatus
  return 'all'
}

function formatCanonicalAmount(value: number, decimalPlaces: number): string {
  if (!Number.isFinite(value)) return ''
  const sign = value < 0 ? '-' : ''
  const places = Math.max(decimalPlaces, 0)
  const [whole, frac = ''] = Math.abs(value).toFixed(places).split('.')
  const minor = BigInt(whole || '0') * (10n ** BigInt(places)) + BigInt((frac || '').padEnd(places, '0') || '0')
  return `${sign}${canonicalFromMinor(minor, places)}`
}

export function formatMoney(value: number, currency: FinanceCurrency): string {
  return `${formatCanonicalAmount(value, currency.decimal_places)} ${currency.symbol}`
}

export function formatNullableAmount(value: number | null, currency: FinanceCurrency, unknownLabel: string): string {
  if (value == null) return unknownLabel
  return formatMoney(value, currency)
}

export function formatNullablePercent(value: number | null, unknownLabel: string): string {
  if (value == null) return unknownLabel
  if (Number.isInteger(value)) return `${value}%`
  return `${formatCanonicalAmount(value, 2)}%`
}

export function formatUtilization(value: number | null, unknownLabel: string): string {
  if (value == null) return unknownLabel
  return `${formatCanonicalAmount(value, 2)}%`
}

export function isFinanceIsoDate(value: string | null | undefined): boolean {
  if (value == null || value === '') return false
  if (!ISO_DATE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function emptyFinanceDraft(kind: FinanceKind = 'budget'): FinanceDraft {
  return {
    kind,
    title: '',
    amountInput: '',
    expenseDate: null,
    reference: '',
    notes: '',
    budgetEntryId: null,
  }
}

export function draftFromEntry(record: FinanceEntryLike, decimalPlaces = 2): FinanceDraft {
  const amount = parseMoneyInput(String(record.amount), decimalPlaces)
  return {
    kind: record.kind,
    title: record.title,
    amountInput: amount.ok ? amount.canonical : String(record.amount),
    expenseDate: record.expense_date,
    reference: record.reference,
    notes: record.notes,
    budgetEntryId: record.budget_entry_id,
  }
}

export function snapshotFinanceDraft(draft: FinanceDraft): FinanceDraft {
  return { ...draft }
}

export function isFinanceDraftDirty(draft: FinanceDraft, baseline: FinanceDraft, decimalPlaces = 2): boolean {
  if (
    draft.kind !== baseline.kind
    || draft.title.trim() !== baseline.title.trim()
    || draft.expenseDate !== baseline.expenseDate
    || draft.reference !== baseline.reference
    || draft.notes !== baseline.notes
    || draft.budgetEntryId !== baseline.budgetEntryId
  ) return true
  const nextAmount = parseMoneyInput(draft.amountInput, decimalPlaces)
  const baselineAmount = parseMoneyInput(baseline.amountInput, decimalPlaces)
  if (nextAmount.ok && baselineAmount.ok) return nextAmount.canonical !== baselineAmount.canonical
  return draft.amountInput !== baseline.amountInput
}

export function validateFinanceDraft(draft: FinanceDraft, decimalPlaces: number): FinanceFieldError[] {
  const errors: FinanceFieldError[] = []
  const title = draft.title.trim()
  if (!title) errors.push({ field: 'title', code: 'required' })
  else if (title.length > TITLE_MAX) errors.push({ field: 'title', code: 'too_long' })

  const amount = parseMoneyInput(draft.amountInput, decimalPlaces)
  if (!amount.ok) errors.push({ field: 'amount', code: amount.code })
  else if (draft.kind === 'expense' && amount.minor <= 0n) errors.push({ field: 'amount', code: 'positive' })

  if (draft.kind === 'expense') {
    if (!draft.expenseDate) errors.push({ field: 'expense_date', code: 'required' })
    else if (!isFinanceIsoDate(draft.expenseDate)) errors.push({ field: 'expense_date', code: 'invalid' })
  }

  if (draft.reference.length > REFERENCE_MAX) errors.push({ field: 'reference', code: 'too_long' })
  if (draft.notes.length > NOTES_MAX) errors.push({ field: 'notes', code: 'too_long' })
  return errors
}

function amountFromDraft(draft: FinanceDraft, decimalPlaces: number): number {
  const amount = parseMoneyInput(draft.amountInput, decimalPlaces)
  if (!amount.ok) throw new Error(amount.code)
  return amount.value
}

export function financeCreateBody(draft: FinanceDraft, decimalPlaces: number): FinanceEntryCreate {
  const title = draft.title.trim()
  const amount = amountFromDraft(draft, decimalPlaces)
  const reference = draft.reference.trim()
  const notes = draft.notes
  if (draft.kind === 'budget') {
    return {
      kind: 'budget',
      title,
      amount,
      ...(reference ? { reference } : {}),
      ...(notes ? { notes } : {}),
    }
  }
  return {
    kind: 'expense',
    title,
    amount,
    expense_date: draft.expenseDate ?? '',
    ...(reference ? { reference } : {}),
    ...(notes ? { notes } : {}),
    ...(draft.budgetEntryId ? { budget_entry_id: draft.budgetEntryId } : {}),
  }
}

export function financePatchBody(
  draft: FinanceDraft,
  baseline: FinanceDraft,
  expectedUpdatedAt: string,
  decimalPlaces: number,
): FinanceEntryPatch {
  const patch: FinanceEntryPatch = { expected_updated_at: expectedUpdatedAt }
  if (draft.title.trim() !== baseline.title.trim()) patch.title = draft.title.trim()
  const nextAmount = parseMoneyInput(draft.amountInput, decimalPlaces)
  const baselineAmount = parseMoneyInput(baseline.amountInput, decimalPlaces)
  if (nextAmount.ok && (!baselineAmount.ok || nextAmount.canonical !== baselineAmount.canonical)) {
    patch.amount = nextAmount.value
  }
  if (draft.reference !== baseline.reference) patch.reference = draft.reference
  if (draft.notes !== baseline.notes) patch.notes = draft.notes
  if (draft.kind === 'expense') {
    if (draft.expenseDate !== baseline.expenseDate) patch.expense_date = draft.expenseDate
    if (draft.budgetEntryId !== baseline.budgetEntryId) patch.budget_entry_id = draft.budgetEntryId
  }
  return patch
}

export function financePatchHasMutation(patch: FinanceEntryPatch): boolean {
  return Object.keys(patch).some(key => key !== 'expected_updated_at')
}

type BudgetStatus = 'unknown' | 'over' | 'within'

export function budgetStatus(summary: { planned: number | null; actual: number; over_budget: boolean }): BudgetStatus {
  if (summary.planned == null) return 'unknown'
  if (summary.over_budget || summary.actual > summary.planned) return 'over'
  return 'within'
}

type FinanceSummaryMode = 'empty' | 'need-budget' | 'dashboard'

// An external actual always shows its source tile, even before the first budget row or posted line.
export function financeSummaryMode(summary: { planned: number | null; budget_count: number; expense_count: number; actual_source?: ActualSource }): FinanceSummaryMode {
  if (summary.actual_source !== 'external' && summary.budget_count === 0 && summary.expense_count === 0) return 'empty'
  if (summary.planned == null) return 'need-budget'
  return 'dashboard'
}

export function isExternalActual(summary: { actual_source: ActualSource }): boolean {
  return summary.actual_source === 'external'
}

/** The kinds the ledger filter offers: an external actual has no manual expenses, only budget rows. */
export function financeKindFilters(summary: { actual_source: ActualSource } | undefined): FinanceKindFilter[] {
  return summary && isExternalActual(summary) ? ['all', 'budget'] : ['all', 'budget', 'expense']
}

export function actualLinesQuery(filters: { limit?: number; offset?: number }) {
  const { limit, offset } = financeListQuery(filters)
  return { limit, offset }
}

/** A cost center as the pickers list it: its code first, when it has one. */
export function actualAccountLabel(account: Pick<ActualAccount, 'name' | 'code'>): string {
  return account.code ? `${account.code} · ${account.name}` : account.name
}

/** The message key of a refused cost center choice: a taken cost center or an unknown one, else the generic error. */
export function actualAccountErrorKey(error: unknown): string {
  if (error instanceof ApiError && error.status === 409 && error.code === 'account_linked') return 'projects.finance.actualAccount.linked'
  if (error instanceof ApiError && error.status === 422 && error.field === 'account_id') return 'projects.finance.actualAccount.invalid'
  return 'errors.generic'
}

export function clampListOffset(offset: number, total: number, pageSize: number): number {
  const size = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 1
  const count = Number.isInteger(total) && total > 0 ? total : 0
  const start = Number.isInteger(offset) && offset > 0 ? offset : 0
  if (count === 0) return 0
  const maxOffset = Math.floor((count - 1) / size) * size
  return Math.min(start, maxOffset)
}

export function nextOffsetAfterListResult(params: {
  isFetching: boolean
  requestedOffset: number
  responseOffset: number
  total: number | undefined
  pageSize: number
}): number | null {
  if (params.isFetching || params.total === undefined) return null
  if (params.requestedOffset !== params.responseOffset) return null
  const next = clampListOffset(params.requestedOffset, params.total, params.pageSize)
  return next === params.requestedOffset ? null : next
}

/**
 * What an unfiltered first page with no ledger rows means. `bare`: nothing is recorded at all, so the page invites a
 * first entry. `actual-only`: an external cost center already carries actual lines, so the ledger is simply empty and
 * must neither say "no entries" nor show an empty table.
 */
export function ledgerEmptiness(params: {
  ledgerEmpty: boolean
  filtered: boolean
  offset: number
  summary: { actual_source: ActualSource; expense_count: number }
}): 'none' | 'bare' | 'actual-only' {
  if (!params.ledgerEmpty || params.filtered || params.offset !== 0) return 'none'
  return isExternalActual(params.summary) && params.summary.expense_count > 0 ? 'actual-only' : 'bare'
}

export function financeSubmitToken(params: {
  stale: boolean
  overwrite: boolean
  writeToken: string | null
  latestToken: string | null
  latestFetchFailed: boolean
}): string | null {
  if (params.stale && !params.overwrite) return null
  if (params.overwrite) return params.latestFetchFailed ? null : params.latestToken
  return params.writeToken
}

export function financeWriteAllowed(access: { can_manage?: boolean } | null | undefined, error: unknown): boolean {
  if (error) return false
  return access?.can_manage === true
}

export function shouldKeepFinanceFormMounted(state: { hasCachedEntry: boolean; hasCachedAccess: boolean }): boolean {
  return state.hasCachedEntry || state.hasCachedAccess
}

export function isStaleFinanceWrite(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === 'stale_write'
}

export function isReferencedBudgetConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code !== 'stale_write'
}

export function financeFieldErrorKey(field: string): string {
  switch (field) {
    case 'title':
    case 'amount':
    case 'expense_date':
    case 'reference':
    case 'notes':
    case 'budget_entry_id':
    case 'kind':
    case 'expected_updated_at':
      return `projects.finance.fields.${field}`
    default:
      return 'projects.finance.fields.unknown'
  }
}
