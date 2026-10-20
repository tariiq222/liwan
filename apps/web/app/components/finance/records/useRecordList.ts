import type { UseQueryReturnType } from '@tanstack/vue-query'
import { useRouteListFilters } from '@/composables/useRouteListFilters'
import { RECORD_PAGE_SIZE, recordActiveFilterCount, recordFiltersFromQuery, recordParams, type RecordParams } from './recordParams'

/**
 * The state every setup list shares: its filters in the URL (search, one kind, archived, page), the page of rows the query
 * returns, and the handlers of the filter bar. A section adds its own table and editor on top.
 */
export function useRecordList<Item>(options: {
  fallbackPath: string
  /** The kinds the list can be filtered by, and the name of that filter in the API query (both absent: no kind filter). */
  kinds?: readonly string[]
  kindParam?: string
  /** False for a list whose API has no search (journals). */
  searchable?: boolean
  list: (params: () => RecordParams) => UseQueryReturnType<{ items: Item[]; total: number }, Error>
}) {
  const searchable = options.searchable ?? true
  const { hydrated, filterQuery, search, update } = useRouteListFilters({ fallbackPath: () => options.fallbackPath, safeReturnTo: (_value, fallback) => fallback })
  const filters = computed(() => recordFiltersFromQuery(filterQuery.value, options.kinds))
  const activeCount = computed(() => recordActiveFilterCount(filters.value))
  const query = options.list(() => recordParams(filters.value, options.kindParam ?? null, searchable))
  const items = computed(() => query.data.value?.items ?? [])
  const total = computed(() => query.data.value?.total ?? 0)
  const pages = computed(() => Math.max(1, Math.ceil(total.value / RECORD_PAGE_SIZE)))
  const showEmpty = computed(() => !query.isPending.value && !query.error.value && items.value.length === 0)
  function clearFilters() {
    search.value = ''
    void update({ q: undefined, kind: undefined, archived: undefined, page: undefined })
  }
  return {
    hydrated, filters, activeCount, query, items, total, pages, showEmpty, search, clearFilters,
    setKind: (value: unknown) => update({ kind: value === 'all' ? undefined : String(value), page: undefined }),
    setState: (value: unknown) => update({ archived: value === 'archived' ? 'true' : undefined, page: undefined }),
    setPage: (value: number) => update({ page: value > 1 ? String(value) : undefined }),
    submitSearch: () => update({ q: search.value.trim() || undefined, page: undefined }),
  }
}
