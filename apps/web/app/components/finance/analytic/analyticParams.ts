import { queryPositiveInt, queryText } from '../../../utils/routeQuery'

export const ANALYTIC_PAGE_SIZE = 25
export const ANALYTIC_LINE_PAGE_SIZE = 50

/** What the cost center filter bar can say: only the filters `GET /finance/analytic-accounts` supports. */
export interface AnalyticAccountFilters {
  q: string
  planId: number | null
  archived: boolean
  page: number
}

export interface AnalyticAccountParams {
  q?: string
  plan_id?: number
  archived: 'true' | 'false'
  limit: number
  offset: number
}

/** The cost center filters out of a route query; anything the API would refuse is dropped. */
export function analyticFiltersFromQuery(query: Record<string, unknown>): AnalyticAccountFilters {
  return {
    q: queryText(query.q) ?? '',
    planId: queryPositiveInt(query.plan_id),
    archived: queryText(query.archived) === 'true',
    page: queryPositiveInt(query.page) ?? 1,
  }
}

/** The number of filters the bar has applied (the search box counts too). */
export function analyticActiveFilterCount(filters: AnalyticAccountFilters): number {
  return Number(!!filters.q) + Number(filters.planId !== null) + Number(filters.archived)
}

export function analyticAccountParams(filters: AnalyticAccountFilters): AnalyticAccountParams {
  return {
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.planId ? { plan_id: filters.planId } : {}),
    archived: filters.archived ? 'true' : 'false',
    limit: ANALYTIC_PAGE_SIZE,
    offset: (filters.page - 1) * ANALYTIC_PAGE_SIZE,
  }
}

/** The query of `GET /finance/reports/analytic/lines`: one cost center's items in the report period. */
export interface AnalyticLineParams {
  account_id: number
  date_from: string
  date_to: string
  limit: number
  offset: number
}

export function analyticLineParams(accountId: number, period: { dateFrom: string; dateTo: string }, page: number): AnalyticLineParams {
  return { account_id: accountId, date_from: period.dateFrom, date_to: period.dateTo, limit: ANALYTIC_LINE_PAGE_SIZE, offset: (page - 1) * ANALYTIC_LINE_PAGE_SIZE }
}
