import type { FinanceBudget } from '@liwan/contracts'
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'
import { financeListKpiTiles, financeStateTiles } from '../../../utils/financeKpis'
import { queryPositiveInt, queryText } from '../../../utils/routeQuery'
import { BUDGETS_PATH } from './budgetPaths'

export const BUDGET_PAGE_SIZE = 25
export const BUDGET_STATES = ['draft', 'confirmed', 'cancelled'] as const satisfies readonly FinanceBudget['state'][]
export type BudgetStateFilter = (typeof BUDGET_STATES)[number]

/** What the filter bar can say: only the filters `GET /finance/budgets` supports. */
export interface BudgetListFilters {
  q: string
  state: BudgetStateFilter | null
  page: number
}

export interface BudgetListParams {
  state?: BudgetStateFilter
  q?: string
  limit: number
  offset: number
}

/** The list filters out of a route query; anything the API would refuse is dropped. */
export function budgetFiltersFromQuery(query: Record<string, unknown>): BudgetListFilters {
  const state = queryText(query.state)
  return {
    q: queryText(query.q) ?? '',
    state: BUDGET_STATES.find(value => value === state) ?? null,
    page: queryPositiveInt(query.page) ?? 1,
  }
}

/** The number of filters the bar has applied (the search box counts too). */
export function budgetActiveFilterCount(filters: BudgetListFilters): number {
  return Number(!!filters.q) + Number(!!filters.state)
}

export function budgetListParams(filters: BudgetListFilters): BudgetListParams {
  return {
    ...(filters.state ? { state: filters.state } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    limit: BUDGET_PAGE_SIZE,
    offset: (filters.page - 1) * BUDGET_PAGE_SIZE,
  }
}

/** The summary has the list filters, without its selected state or page window. */
export function budgetSummaryParams(filters: BudgetListFilters) {
  const { state: _state, limit: _limit, offset: _offset, ...params } = budgetListParams(filters)
  return params
}

export type BudgetKpiId = 'total' | BudgetStateFilter
export type BudgetKpiCounts = Record<BudgetKpiId, number | undefined>

const BUDGET_KPI_STATES = [
  { id: 'draft', icon: 'i-lucide-file-pen', tone: 'warning' },
  { id: 'confirmed', icon: 'i-lucide-circle-check', tone: 'success' },
  { id: 'cancelled', icon: 'i-lucide-circle-x', tone: 'neutral' },
] as const

/** The strip above the list: one tile per state, linked to the list's own filters. */
export function budgetKpiTiles(filters: BudgetListFilters, counts: BudgetKpiCounts, t: (key: string) => string): KpiTile[] {
  return financeListKpiTiles(
    financeStateTiles(BUDGET_KPI_STATES, 'i-lucide-target', id => t(`financeBudgets.kpi.${id}`)),
    counts,
    BUDGETS_PATH,
    { q: filters.q },
  )
}
