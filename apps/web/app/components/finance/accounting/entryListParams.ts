import type { JournalEntry } from '@liwan/contracts'
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'
import { queryDay, queryPositiveInt, queryText } from '../../../utils/routeQuery'

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

/** One KPI count: the list's own filters with the tile's state, and one row asked for because only `total` is read. */
export function entryKpiParams(filters: EntryListFilters, state: EntryStateFilter | null): EntryListParams {
  return { ...entryListParams({ ...filters, state, page: 1 }), limit: 1, offset: 0 }
}

export type EntryKpiId = 'total' | EntryStateFilter
export type EntryKpiCounts = Record<EntryKpiId, number | undefined>

const KPI_TONE = { total: 'neutral', draft: 'warning', posted: 'success', cancel: 'neutral' } as const
const KPI_ICON = { total: 'i-lucide-notebook-pen', draft: 'i-lucide-file-pen', posted: 'i-lucide-file-check', cancel: 'i-lucide-file-x' } as const

/** The strip above the list: the counts the server reports for the list's filters, one tile per state. */
export function entryKpiTiles(counts: EntryKpiCounts, label: (id: EntryKpiId) => string): KpiTile[] {
  return (['total', ...ENTRY_STATES] as const).map(id => ({
    id,
    label: label(id),
    value: counts[id] ?? null,
    icon: KPI_ICON[id],
    tone: KPI_TONE[id],
  }))
}
