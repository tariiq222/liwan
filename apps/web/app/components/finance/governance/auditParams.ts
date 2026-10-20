import { FinanceAuditActionSchema, type FinanceAuditEvent } from '@webvue/contracts'
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
