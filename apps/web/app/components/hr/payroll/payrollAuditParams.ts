import { HR_PAYROLL_AUDIT_ACTIONS, type HrPayrollAuditEvent } from '@liwan/contracts'
import { queryDay, queryPositiveInt, queryText } from '../../../utils/routeQuery'

export const PAYROLL_AUDIT_PAGE_SIZE = 25
export const PAYROLL_AUDIT_PATH = '/settings/apps/hr/audit'
export type PayrollAuditAction = HrPayrollAuditEvent['action']

/** What the filter bar can say: only the filters `GET /hr/payroll/audit-events` supports. */
export interface PayrollAuditFilters {
  action: PayrollAuditAction | null
  dateFrom: string | null
  dateTo: string | null
  page: number
}

export interface PayrollAuditParams {
  action?: PayrollAuditAction
  date_from?: string
  date_to?: string
  limit: number
  offset: number
}

/** The list filters out of a route query; anything the API would refuse is dropped. */
export function payrollAuditFiltersFromQuery(query: Record<string, unknown>): PayrollAuditFilters {
  const action = queryText(query.action)
  const dateFrom = queryDay(query.date_from)
  const dateTo = queryDay(query.date_to)
  const ordered = !dateFrom || !dateTo || dateFrom <= dateTo
  return {
    action: HR_PAYROLL_AUDIT_ACTIONS.find(value => value === action) ?? null,
    dateFrom,
    dateTo: ordered ? dateTo : null,
    page: queryPositiveInt(query.page) ?? 1,
  }
}

export function payrollAuditActiveFilterCount(filters: PayrollAuditFilters): number {
  return Number(!!filters.action) + Number(!!filters.dateFrom) + Number(!!filters.dateTo)
}

export function payrollAuditParams(filters: PayrollAuditFilters): PayrollAuditParams {
  return {
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.dateFrom ? { date_from: filters.dateFrom } : {}),
    ...(filters.dateTo ? { date_to: filters.dateTo } : {}),
    limit: PAYROLL_AUDIT_PAGE_SIZE,
    offset: (filters.page - 1) * PAYROLL_AUDIT_PAGE_SIZE,
  }
}

/** The moment of an audit row in the user's locale; Latin digits are kept so figures read the same everywhere. */
export function formatPayrollAuditTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}
