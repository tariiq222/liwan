import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'
import { queryDay, queryPositiveInt } from '../../../utils/routeQuery'

export const BANK_PAGE_SIZE = 25

/** What the filter bar can say: only the filters `GET /finance/bank-statements` supports. */
export interface BankListFilters {
  journalId: number | null
  dateFrom: string | null
  dateTo: string | null
  page: number
}

export interface BankListParams {
  journal_id?: number
  date_from?: string
  date_to?: string
  limit: number
  offset: number
}

type Query = Record<string, unknown>

/** The list filters out of a route query; anything the API would refuse is dropped. */
export function bankFiltersFromQuery(query: Query): BankListFilters {
  const dateFrom = queryDay(query.date_from)
  const dateTo = queryDay(query.date_to)
  const ordered = !dateFrom || !dateTo || dateFrom <= dateTo
  return {
    journalId: queryPositiveInt(query.journal_id),
    dateFrom,
    dateTo: ordered ? dateTo : null,
    page: queryPositiveInt(query.page) ?? 1,
  }
}

export function bankActiveFilterCount(filters: BankListFilters): number {
  return Number(!!filters.journalId) + Number(!!filters.dateFrom) + Number(!!filters.dateTo)
}

export function bankListParams(filters: BankListFilters): BankListParams {
  return {
    ...(filters.journalId ? { journal_id: filters.journalId } : {}),
    ...(filters.dateFrom ? { date_from: filters.dateFrom } : {}),
    ...(filters.dateTo ? { date_to: filters.dateTo } : {}),
    limit: BANK_PAGE_SIZE,
    offset: (filters.page - 1) * BANK_PAGE_SIZE,
  }
}

/** One KPI count: the given filters (none for "all statements"), and one row asked for because only `total` is read. */
export function bankKpiParams(filters: BankListFilters | null): BankListParams {
  return { ...bankListParams(filters ? { ...filters, page: 1 } : { journalId: null, dateFrom: null, dateTo: null, page: 1 }), limit: 1, offset: 0 }
}

export type BankKpiId = 'all' | 'filtered'

/** The strip above the list: every statement, and (only while a filter applies) the ones the filters keep. */
export function bankKpiTiles(counts: Record<BankKpiId, number | undefined>, filtered: boolean, label: (id: BankKpiId) => string): KpiTile[] {
  const ids: BankKpiId[] = filtered ? ['all', 'filtered'] : ['all']
  return ids.map(id => ({ id, label: label(id), value: counts[id] ?? null, icon: id === 'all' ? 'i-lucide-landmark' : 'i-lucide-list-filter', tone: 'neutral' }))
}
