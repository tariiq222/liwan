import type { FinanceBudget } from '@liwan/contracts'
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'
import { queryPositiveInt, queryText } from '../../../utils/routeQuery'

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

/** One KPI count: the list's own filters with the tile's state, and one row asked for because only `total` is read. */
export function budgetKpiParams(filters: BudgetListFilters, state: BudgetStateFilter | null): BudgetListParams {
  return { ...budgetListParams({ ...filters, state, page: 1 }), limit: 1, offset: 0 }
}

export type BudgetKpiId = 'total' | BudgetStateFilter
export type BudgetKpiCounts = Record<BudgetKpiId, number | undefined>

const KPI_TONE = { total: 'neutral', draft: 'warning', confirmed: 'success', cancelled: 'neutral' } as const
const KPI_ICON = { total: 'i-lucide-target', draft: 'i-lucide-file-pen', confirmed: 'i-lucide-circle-check', cancelled: 'i-lucide-circle-x' } as const

/** The strip above the list: the counts the server reports for the list's filters, one tile per state. */
export function budgetKpiTiles(counts: BudgetKpiCounts, label: (id: BudgetKpiId) => string): KpiTile[] {
  return (['total', ...BUDGET_STATES] as const).map(id => ({
    id,
    label: label(id),
    value: counts[id] ?? null,
    icon: KPI_ICON[id],
    tone: KPI_TONE[id],
  }))
}
