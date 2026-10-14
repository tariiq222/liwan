import { useInfiniteQuery } from '@tanstack/vue-query'
import type { ComputedRef, MaybeRefOrGetter, Ref } from 'vue'
import { computed, toValue } from 'vue'
import type { ZodType } from 'zod'
import { searchProviders } from '../modules/surfaces'
import type { AppSearchApi, AppSearchProvider, AppSearchRow } from '../modules/types'

export interface AppSearchSection {
  provider: AppSearchProvider
  rows: ComputedRef<AppSearchRow[]>
  /** The provider's first page, before the client filter (for the truncation notice). */
  truncated: ComputedRef<boolean>
  loading: ComputedRef<boolean>
  /** Loading, or waiting for the debounce on a server-side search. */
  waiting: ComputedRef<boolean>
  error: ComputedRef<unknown>
  hasNext: ComputedRef<boolean>
  fetchingNext: ComputedRef<boolean>
  refetch: () => unknown
  fetchNext: () => unknown
  visible: ComputedRef<boolean>
}

/** The provider's fetcher with vue-query's abort signal, so a superseded term's request is cancelled. */
function withSignal(api: AppSearchApi, signal: AbortSignal): AppSearchApi {
  return <T>(url: string, options: { query?: Record<string, unknown>; schema: ZodType<T>; signal?: AbortSignal }) =>
    api(url, { ...options, signal })
}

/**
 * One section per application search provider the user can use. `term` is what the user typed
 * (client filter), `debounced` what server searches send. `gate` adds a surface condition
 * (the dialog is open); `requireTerm` keeps the dialog from fetching before the user types.
 */
export function useAppSearch(options: {
  surface: 'dialog' | 'page'
  term: Ref<string>
  debounced: Ref<string>
  gate: MaybeRefOrGetter<boolean>
  requireTerm: boolean
  can: (capability: string) => boolean
  api: AppSearchApi
}): AppSearchSection[] {
  const { term, debounced, can, api } = options
  const needle = computed(() => term.value.toLocaleLowerCase())
  // Providers are read once at setup: each owns a vue-query observer created here, so the list cannot change per call.
  return searchProviders(options.surface).map((provider) => {
    const query = useInfiniteQuery({
      queryKey: computed(() => provider.queryKey(provider.serverSearch ? debounced.value : '')),
      enabled: computed(() => toValue(options.gate) && can(provider.capability) && (!options.requireTerm || !!debounced.value)),
      queryFn: ({ pageParam, signal }) => provider.search(withSignal(api, signal), provider.serverSearch ? debounced.value : '', pageParam),
      initialPageParam: 0,
      getNextPageParam: (last, pages) => {
        if (last.total === undefined) return undefined
        const loaded = pages.reduce((count, page) => count + page.rows.length, 0)
        return loaded < last.total ? loaded : undefined
      },
    })
    const all = computed(() => (query.data.value?.pages ?? []).flatMap(page => page.rows))
    const settled = computed(() => !!term.value && term.value === debounced.value)
    const rows = computed(() => {
      if (provider.serverSearch) return settled.value ? all.value : []
      return all.value.filter(row => row.label.toLocaleLowerCase().includes(needle.value))
    })
    const loading = computed(() => query.isLoading.value)
    return {
      provider,
      rows,
      truncated: computed(() => !!query.data.value?.pages[0]?.truncated),
      loading,
      waiting: computed(() => provider.serverSearch ? !!term.value && (term.value !== debounced.value || loading.value) : loading.value),
      error: computed(() => query.error.value),
      hasNext: computed(() => !!query.hasNextPage.value),
      fetchingNext: computed(() => query.isFetchingNextPage.value),
      refetch: () => query.refetch(),
      fetchNext: () => query.fetchNextPage(),
      visible: computed(() => can(provider.capability)),
    }
  })
}
