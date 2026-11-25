import { kpiLink } from '@liwan/ui/app/utils/kpiLink'
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'
import { queryDay, queryPositiveInt } from '../../../utils/routeQuery'
import { BANK_STATEMENTS_PATH } from './bankModel'

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

/**
 * The strip above the list: every statement linked to the list without the filters, and (only while a filter applies)
 * the statements the filters keep, linked to the list with them and clearing back to all statements.
 */
export function bankKpiTiles(filters: BankListFilters, counts: Record<BankKpiId, number | null | undefined>, label: (id: BankKpiId) => string): KpiTile[] {
  const tiles: KpiTile[] = [
    { id: 'all', label: label('all'), value: counts.all ?? null, icon: 'i-lucide-landmark', tone: 'neutral', to: BANK_STATEMENTS_PATH },
  ]
  if (bankActiveFilterCount(filters) > 0) {
    const kept = kpiLink(BANK_STATEMENTS_PATH, { journal_id: filters.journalId ?? undefined, date_from: filters.dateFrom ?? undefined, date_to: filters.dateTo ?? undefined })
    tiles.push({ id: 'filtered', label: label('filtered'), value: counts.filtered ?? null, icon: 'i-lucide-list-filter', tone: 'neutral', to: kept, clearTo: BANK_STATEMENTS_PATH })
  }
  return tiles
}

