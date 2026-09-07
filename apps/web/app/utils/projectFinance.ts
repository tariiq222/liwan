import { PROJECT_STATUSES, type FinanceEntry, type FinanceEntryCreate, type FinanceEntryPatch, type FinanceKind, type ProjectStatus } from '@nasq/contracts'
import { ApiError } from '../composables/useApi'

export const FINANCE_PAGE = 50
export const REPORT_PAGE = 50
export const MAX_FINANCE_AMOUNT = 1e12
export const FINANCE_RETURN_PREFIXES = ['/projects', '/reports'] as const

export type FinanceKindFilter = 'all' | FinanceKind
export type FinanceListRouteState = {
  kind: FinanceKindFilter
  q: string
  offset: number
}

export type ProjectReportStatusFilter = 'all' | 'unset' | ProjectStatus
export type ReportListRouteState = {
  q: string
  status: ProjectReportStatusFilter
  offset: number
}

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
export type FinanceFieldError = { field: FinanceFieldKey; code: string }

export type MoneyParse =
  | { ok: true; value: number; minor: bigint; canonical: string }
  | { ok: false; code: 'empty' | 'invalid' | 'negative' | 'precision' | 'too_large' }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
const TITLE_MAX = 200
const REFERENCE_MAX = 200
const NOTES_MAX = 10000

export function parsePositiveId(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw === 'number') return Number.isInteger(raw) && raw > 0 ? raw : null
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return null
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

function parseOffset(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value
  const n = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : 0
  if (!Number.isInteger(n) || n < 0) return 0
  return n
}

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

export function financeListPath(projectId: number, state: FinanceListRouteState): string {
  const query = serializeFinanceListRoute(state)
  const params = new URLSearchParams()
  if (query.kind) params.set('kind', query.kind)
  if (query.q) params.set('q', query.q)
  if (query.offset) params.set('offset', String(query.offset))
  const suffix = params.toString()
  return suffix ? `/projects/${projectId}/finance?${suffix}` : `/projects/${projectId}/finance`
}

export function parseReportStatus(value: unknown): ProjectReportStatusFilter {
  if (value === 'unset') return 'unset'
  if (typeof value === 'string' && (PROJECT_STATUSES as readonly string[]).includes(value)) return value as ProjectStatus
  return 'all'
}

export function parseReportListRoute(query: Record<string, unknown>): ReportListRouteState {
  return {
    q: firstQueryString(query.q),
    status: parseReportStatus(query.status),
    offset: parseOffset(query.offset),
  }
}

export function serializeReportListRoute(state: ReportListRouteState) {
  return {
    q: state.q.trim() || undefined,
    status: state.status === 'all' ? undefined : state.status,
    offset: state.offset || undefined,
  }
}

export function patchReportListRoute(
  current: ReportListRouteState,
  patch: Partial<ReportListRouteState>,
): ReportListRouteState {
  const next: ReportListRouteState = {
    q: patch.q ?? current.q,
    status: patch.status ?? current.status,
    offset: patch.offset ?? current.offset,
  }
  if (patch.offset === undefined && (patch.q !== undefined || patch.status !== undefined)) {
    next.offset = 0
  }
  return {
    q: next.q,
    status: parseReportStatus(next.status === 'all' ? undefined : next.status),
    offset: parseOffset(next.offset),
  }
}

export function sameReportListRoute(
  left: ReturnType<typeof serializeReportListRoute>,
  right: ReturnType<typeof serializeReportListRoute>,
) {
  return left.q === right.q && left.status === right.status && left.offset === right.offset
}

export function reportListQuery(filters: {
  q?: string
  status?: ProjectReportStatusFilter
  limit?: number
  offset?: number
}) {
  const rawLimit = filters.limit ?? REPORT_PAGE
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : REPORT_PAGE
  const rawOffset = filters.offset ?? 0
  const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0
  return {
    q: filters.q?.trim() || undefined,
    status: filters.status && filters.status !== 'all' ? filters.status : undefined,
    limit,
    offset,
  }
}

export function reportListPath(state: ReportListRouteState): string {
  const query = serializeReportListRoute(state)
  const params = new URLSearchParams()
  params.set('view', 'reports')
  if (query.q) params.set('q', query.q)
  if (query.status) params.set('status', query.status)
  if (query.offset) params.set('offset', String(query.offset))
  const suffix = params.toString()
  return `/projects?${suffix}`
}

function mapDigit(char: string): string {
  const arabic = ARABIC_DIGITS.indexOf(char)
  if (arabic >= 0) return String(arabic)
  const persian = PERSIAN_DIGITS.indexOf(char)
  if (persian >= 0) return String(persian)
  return char
}

const ARABIC_DECIMAL = '\u066b'
const ARABIC_THOUSANDS = '\u066c'
const THOUSANDS_SPACE = /[ \u00a0\u202f]/

function parseGroupedInteger(raw: string): string | null {
  if (!raw) return null
  if (/^\d+$/.test(raw)) return raw
  const seps = new Set([...raw].filter(char => !/\d/.test(char)))
  if (seps.size !== 1) return null
  const sep = [...seps][0]!
  if (sep !== ',' && sep !== ARABIC_THOUSANDS && !THOUSANDS_SPACE.test(sep)) return null
  const parts = raw.split(sep)
  if (parts[0]!.length < 1 || parts[0]!.length > 3) return null
  if (parts.some(part => part === '' || !/^\d+$/.test(part))) return null
  if (parts.slice(1).some(part => part.length !== 3)) return null
  if (parts.length < 2) return null
  return parts.join('')
}

function parseCommaAmount(raw: string, decimalPlaces: number): { integer: string; fraction: string } | null {
  const parts = raw.split(',')
  if (parts.length < 2 || parts.some(part => part === '' || !/^\d+$/.test(part))) return null
  const last = parts[parts.length - 1]!
  const head = parts.slice(0, -1)
  if (last.length === 3 && last.length <= decimalPlaces) return null
  if (last.length === 3) {
    const integer = parseGroupedInteger(raw)
    return integer ? { integer, fraction: '' } : null
  }
  if (last.length < 1 || last.length > decimalPlaces) return null
  const integer = head.length === 1 ? (head[0] && /^\d+$/.test(head[0]) ? head[0] : null) : parseGroupedInteger(head.join(','))
  return integer ? { integer, fraction: last } : null
}

function splitAmountParts(mapped: string, decimalPlaces: number): { integer: string; fraction: string } | null {
  const hasDot = mapped.includes('.')
  const hasArabDecimal = mapped.includes(ARABIC_DECIMAL)
  const hasComma = mapped.includes(',')
  const hasArabThousands = mapped.includes(ARABIC_THOUSANDS)
  const hasSpace = THOUSANDS_SPACE.test(mapped)
  if ((mapped.match(/\./g) ?? []).length > 1 || (mapped.match(new RegExp(ARABIC_DECIMAL, 'g')) ?? []).length > 1) return null
  if (hasDot && hasArabDecimal) return null
  if (hasArabDecimal && hasComma) return null
  if (hasDot && hasComma && mapped.lastIndexOf(',') > mapped.indexOf('.')) return null

  if (hasDot || hasArabDecimal) {
    const mark = hasDot ? '.' : ARABIC_DECIMAL
    const [integerRaw, fractionRaw, extra] = mapped.split(mark)
    if (extra !== undefined || integerRaw === undefined || fractionRaw === undefined) return null
    if (fractionRaw === '' || /[^\d]/.test(fractionRaw)) return null
    const integer = parseGroupedInteger(integerRaw)
    return integer ? { integer, fraction: fractionRaw } : null
  }
  if (hasComma) return parseCommaAmount(mapped, decimalPlaces)
  if (hasArabThousands || hasSpace) {
    const integer = parseGroupedInteger(mapped)
    return integer ? { integer, fraction: '' } : null
  }
  if (!/^\d+$/.test(mapped)) return null
  return { integer: mapped, fraction: '' }
}

export function canonicalFromMinor(minor: bigint, decimalPlaces: number): string {
  const negative = minor < 0n
  const abs = negative ? -minor : minor
  if (decimalPlaces <= 0) return `${negative ? '-' : ''}${abs.toString()}`
  const factor = 10n ** BigInt(decimalPlaces)
  const whole = abs / factor
  const frac = (abs % factor).toString().padStart(decimalPlaces, '0')
  return `${negative ? '-' : ''}${whole.toString()}.${frac}`
}

export function parseMoneyInput(raw: string, decimalPlaces: number): MoneyParse {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, code: 'empty' }
  const mapped = Array.from(trimmed, mapDigit).join('')
  if (mapped.startsWith('-') || mapped.includes('-')) return { ok: false, code: 'negative' }
  if (/[eE+]/.test(mapped) || /^(nan|infinity|true|false)$/i.test(mapped)) return { ok: false, code: 'invalid' }
  if (!/^[0-9.,\u066b\u066c \u00a0\u202f]+$/.test(mapped)) return { ok: false, code: 'invalid' }
  const parts = splitAmountParts(mapped, decimalPlaces)
  if (!parts) return { ok: false, code: 'invalid' }
  if (parts.fraction.length > decimalPlaces) return { ok: false, code: 'precision' }
  const whole = parts.integer || '0'
  const fraction = parts.fraction.padEnd(Math.max(decimalPlaces, 0), '0')
  const minor = BigInt(whole) * (10n ** BigInt(Math.max(decimalPlaces, 0))) + BigInt(fraction || '0')
  const maxMinor = BigInt(MAX_FINANCE_AMOUNT) * (10n ** BigInt(Math.max(decimalPlaces, 0)))
  if (minor > maxMinor) return { ok: false, code: 'too_large' }
  const canonical = canonicalFromMinor(minor, decimalPlaces)
  return { ok: true, value: Number(canonical), minor, canonical }
}

export function formatCanonicalAmount(value: number, decimalPlaces: number): string {
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

export function formatNullableCount(value: number | null, unavailableLabel: string): string {
  if (value == null) return unavailableLabel
  return String(value)
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

export function createBodyFromDraft(draft: FinanceDraft, decimalPlaces: number): FinanceEntryCreate {
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

export function patchBodyFromDraft(
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

export type BudgetStatus = 'unknown' | 'over' | 'within'

export function budgetStatus(summary: { planned: number | null; actual: number; over_budget: boolean }): BudgetStatus {
  if (summary.planned == null) return 'unknown'
  if (summary.over_budget || summary.actual > summary.planned) return 'over'
  return 'within'
}

export function formatTotalsPlanned(
  group: { planned: number; budgeted_project_count: number; currency: FinanceCurrency },
  unknownLabel: string,
): string {
  if (group.budgeted_project_count === 0) return unknownLabel
  return formatMoney(group.planned, group.currency)
}

export function formatTotalsRemaining(
  group: { remaining: number; budgeted_project_count: number; currency: FinanceCurrency },
  unknownLabel: string,
): string {
  if (group.budgeted_project_count === 0) return unknownLabel
  return formatMoney(group.remaining, group.currency)
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
