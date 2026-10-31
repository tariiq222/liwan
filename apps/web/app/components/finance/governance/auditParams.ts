import { FinanceAuditActionSchema, type FinanceAuditEvent } from '@liwan/contracts'
import { queryDay, queryPositiveInt, queryText } from '../../../utils/routeQuery'

export const AUDIT_PAGE_SIZE = 25
export const AUDIT_PATH = '/settings/apps/finance/audit'
export const AUDIT_ACTIONS = FinanceAuditActionSchema.options
export type AuditActionFilter = FinanceAuditEvent['action']

/** What the filter bar can say: only the filters `GET /finance/audit-events` supports. */
export interface AuditListFilters {
  action: AuditActionFilter | null
  dateFrom: string | null
  dateTo: string | null
  page: number
}

export interface AuditListParams {
  action?: AuditActionFilter
  date_from?: string
  date_to?: string
  limit: number
  offset: number
}

/** The list filters out of a route query; anything the API would refuse is dropped. */
export function auditFiltersFromQuery(query: Record<string, unknown>): AuditListFilters {
  const action = queryText(query.action)
  const dateFrom = queryDay(query.date_from)
  const dateTo = queryDay(query.date_to)
  const ordered = !dateFrom || !dateTo || dateFrom <= dateTo
  return {
    action: AUDIT_ACTIONS.find(value => value === action) ?? null,
    dateFrom,
    dateTo: ordered ? dateTo : null,
    page: queryPositiveInt(query.page) ?? 1,
  }
}

export function auditActiveFilterCount(filters: AuditListFilters): number {
  return Number(!!filters.action) + Number(!!filters.dateFrom) + Number(!!filters.dateTo)
}

export function auditListParams(filters: AuditListFilters): AuditListParams {
  return {
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.dateFrom ? { date_from: filters.dateFrom } : {}),
    ...(filters.dateTo ? { date_to: filters.dateTo } : {}),
    limit: AUDIT_PAGE_SIZE,
    offset: (filters.page - 1) * AUDIT_PAGE_SIZE,
  }
}

/** The moment of an audit row in the user's locale; Latin digits are kept so figures read the same everywhere. */
export function formatAuditTime(iso: string, locale: string): string {
  const formatter = new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: 'medium', timeStyle: 'short' })
  return formatter.format(new Date(iso))
}

const MODEL_RECORDS = [
  'account.account', 'account.analytic.account', 'account.analytic.plan', 'account.asset', 'account.asset.profile', 'account.bank.statement',
  'account.bank.statement.line', 'account.journal', 'account.payment', 'account.payment.term', 'account.tax', 'liwan.finance.zakat.adjustment',
  'liwan.finance.zakat.review', 'mis.budget.by.account', 'res.company', 'res.partner',
] as const

/** The locale key naming the kind of record an event is about; a journal entry and an invoice share one Odoo model. */
export function auditRecordKey(event: Pick<FinanceAuditEvent, 'action' | 'res_model'>): string {
  if (event.res_model === 'account.move') return event.action.startsWith('invoice_') ? 'invoice' : event.action.startsWith('entry_') ? 'entry' : 'move'
  return (MODEL_RECORDS as readonly string[]).includes(event.res_model) ? event.res_model.replaceAll('.', '_') : 'other'
}

export interface AuditOutcome {
  key: string
  params: Record<string, string>
}

const OUTCOME_SHAPES: [RegExp, string, string[]][] = [
  [/^(\d+) lines, (\d+) reconciled$/, 'linesReconciled', ['lines', 'reconciled']],
  [/^(\d+) lines$/, 'lines', ['lines']],
  [/^(\d+) entries$/, 'entries', ['count']],
  [/^(add|deduct) (.+)$/, 'zakatAdjustment', ['kind', 'amount']],
  [/^statement (\d+)$/, 'statement', ['id']],
  [/^sold for (.+)$/, 'soldFor', ['amount']],
  [/^base (.+)$/, 'zakatBase', ['amount']],
  [/^(\d{4}):(\w+)$/, 'yearClosed', ['year', 'state']],
]

/** The outcome text the server stores, as a locale key with its figures; null when the text is a plain state word. */
export function auditOutcome(outcome: string): AuditOutcome | null {
  for (const [shape, key, names] of OUTCOME_SHAPES) {
    const match = shape.exec(outcome)
    if (match) return { key, params: Object.fromEntries(names.map((name, index) => [name, match[index + 1] ?? ''])) }
  }
  return null
}
