import { refDebounced } from '@vueuse/core'

import { liveHash } from './nav/settingsScroll'

const SEARCH_DEBOUNCE_MS = 300

type Query = Record<string, unknown>

/**
 * The filters a list reads: its own route query, or, when the list is only the backdrop of a create panel
 * (`background`), the query carried in the panel's `returnTo`.
 */
export function listFilterQuery(query: Query, background: boolean, fallbackPath: string, safeReturnTo: (value: unknown, fallback: string) => string): Query {
  if (!background || typeof query.returnTo !== 'string') return query
  const search = safeReturnTo(query.returnTo, fallbackPath).split('?')[1]?.split('#')[0] ?? ''
  return Object.fromEntries(new URLSearchParams(search))
}

export function listPageNumber(value: unknown) {
  const page = Number(value)
  return Math.max(1, Number.isSafeInteger(page) ? page : 1)
}

/**
 * The shared `q` / `page` URL state of a paged list: a debounced search box that writes `?q=`, `update()` for any other key,
 * and the page number read back from the query. Writes wait for hydration, like every control.
 */
export function useRouteListFilters(options: { background?: () => boolean | undefined; fallbackPath: () => string; safeReturnTo: (value: unknown, fallback: string) => string; history?: 'push' | 'replace' }) {
  const route = useRoute()
  const router = useRouter()
  const hydrated = useHydrated()
  const filterQuery = computed(() => listFilterQuery(route.query, !!options.background?.(), options.fallbackPath(), options.safeReturnTo))
  const page = computed(() => listPageNumber(filterQuery.value.page))
  const committedSearch = computed(() => typeof filterQuery.value.q === 'string' ? filterQuery.value.q : '')
  const search = ref(committedSearch.value)
  watch(committedSearch, value => { search.value = value })
  async function update(values: Record<string, string | undefined>) {
    if (!hydrated.value) return
    // The hash of the address bar: a settings page's scroll-spy rewrites it without telling the router.
    const navigate = options.history === 'push' ? router.push : router.replace
    await navigate.call(router, { path: route.path, query: { ...route.query, ...values }, hash: liveHash(route.hash, import.meta.client ? location.hash : undefined) })
  }
  const debounced = refDebounced(search, SEARCH_DEBOUNCE_MS)
  watch(debounced, value => { if (value.trim() !== committedSearch.value.trim()) void update({ q: value.trim() || undefined, page: undefined }) })
  return { hydrated, filterQuery, page, search, committedSearch, update }
}
