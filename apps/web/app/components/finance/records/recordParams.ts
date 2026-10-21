import { queryPositiveInt, queryText } from '../../../utils/routeQuery'

export const RECORD_PAGE_SIZE = 25

/** What the filter bar of a setup list can say: search text, one kind (account type, journal type, tax use), archived, page. */
export interface RecordFilters {
  q: string
  kind: string | null
  archived: boolean
  page: number
}

export interface RecordParams {
  q?: string
  archived: 'true' | 'false'
  limit: number
  offset: number
  [kindParam: string]: string | number | undefined
}

/** The filters out of a route query; a kind the list does not know is dropped, as the API would refuse it. */
export function recordFiltersFromQuery(query: Record<string, unknown>, kinds: readonly string[] = []): RecordFilters {
  const kind = queryText(query.kind)
  return {
    q: queryText(query.q) ?? '',
    kind: kind && kinds.includes(kind) ? kind : null,
    archived: queryText(query.archived) === 'true',
    page: queryPositiveInt(query.page) ?? 1,
  }
}

export function recordActiveFilterCount(filters: RecordFilters): number {
  return Number(!!filters.q) + Number(filters.kind !== null) + Number(filters.archived)
}

/** The query of a list route; `kindParam` is the name that route gives the kind filter (null when it has none). */
export function recordParams(filters: RecordFilters, kindParam: string | null, searchable = true): RecordParams {
  return {
    ...(searchable && filters.q ? { q: filters.q } : {}),
    ...(kindParam && filters.kind ? { [kindParam]: filters.kind } : {}),
    archived: filters.archived ? 'true' : 'false',
    limit: RECORD_PAGE_SIZE,
    offset: (filters.page - 1) * RECORD_PAGE_SIZE,
  }
}
