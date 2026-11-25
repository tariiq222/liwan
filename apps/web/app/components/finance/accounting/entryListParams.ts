import type { JournalEntry } from '@liwan/contracts'
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'
import { financeListKpiTiles, financeStateTiles } from '../../../utils/financeKpis'
import { queryDay, queryPositiveInt, queryText } from '../../../utils/routeQuery'
import { ENTRIES_PATH } from './entryPaths'

export const ENTRY_PAGE_SIZE = 25
export const ENTRY_STATES = ['draft', 'posted', 'cancel'] as const satisfies readonly JournalEntry['state'][]
export type EntryStateFilter = (typeof ENTRY_STATES)[number]

/** What the filter bar can say: only the filters `GET /finance/entries` supports. */
export interface EntryListFilters {
  q: string
  state: EntryStateFilter | null
  journalId: number | null
  dateFrom: string | null
  dateTo: string | null
  page: number
}

export interface EntryListParams {
  state?: EntryStateFilter
  journal_id?: number
  date_from?: string
  date_to?: string
  q?: string
  limit: number
  offset: number
}

/** The list filters out of a route query; anything the API would refuse is dropped. */
export function entryFiltersFromQuery(query: Record<string, unknown>): EntryListFilters {
  const state = queryText(query.state)
  const dateFrom = queryDay(query.date_from)
  const dateTo = queryDay(query.date_to)
  const ordered = !dateFrom || !dateTo || dateFrom <= dateTo
  return {
    q: queryText(query.q) ?? '',
    state: ENTRY_STATES.find(value => value === state) ?? null,
    journalId: queryPositiveInt(query.journal_id),
    dateFrom,
    dateTo: ordered ? dateTo : null,
    page: queryPositiveInt(query.page) ?? 1,
  }
}

/** The number of filters the bar has applied (the search box counts too). */
export function entryActiveFilterCount(filters: EntryListFilters): number {
  return Number(!!filters.q) + Number(!!filters.state) + Number(!!filters.journalId) + Number(!!filters.dateFrom) + Number(!!filters.dateTo)
}

export function entryListParams(filters: EntryListFilters): EntryListParams {
  return {
    ...(filters.state ? { state: filters.state } : {}),
    ...(filters.journalId ? { journal_id: filters.journalId } : {}),
    ...(filters.dateFrom ? { date_from: filters.dateFrom } : {}),
    ...(filters.dateTo ? { date_to: filters.dateTo } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    limit: ENTRY_PAGE_SIZE,
    offset: (filters.page - 1) * ENTRY_PAGE_SIZE,
  }
}

/** The summary has the list filters, without its selected state or page window. */
export function entrySummaryParams(filters: EntryListFilters) {
  const { state: _state, limit: _limit, offset: _offset, ...params } = entryListParams(filters)
  return params
}

export type EntryKpiId = 'total' | EntryStateFilter
export type EntryKpiCounts = Record<EntryKpiId, number | undefined>

const ENTRY_KPI_STATES = [
  { id: 'draft', icon: 'i-lucide-file-pen', tone: 'warning' },
  { id: 'posted', icon: 'i-lucide-file-check', tone: 'success' },
  { id: 'cancel', icon: 'i-lucide-file-x', tone: 'neutral' },
] as const

/** The strip above the list: one tile per state, linked to the list's own filters. */
export function entryKpiTiles(filters: EntryListFilters, counts: EntryKpiCounts, t: (key: string) => string): KpiTile[] {
  return financeListKpiTiles(
    financeStateTiles(ENTRY_KPI_STATES, 'i-lucide-notebook-pen', id => t(`financeAccounting.kpi.${id}`)),
    counts,
    ENTRIES_PATH,
    { q: filters.q, journal_id: filters.journalId ?? undefined, date_from: filters.dateFrom ?? undefined, date_to: filters.dateTo ?? undefined },
  )
}
