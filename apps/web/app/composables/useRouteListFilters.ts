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

/** The last page of `total` rows when `page` lies beyond it (a stale or hand-typed `?page=`), otherwise null. */
export function pageBeyondLast(page: number, total: number, pageSize: number): number | null {
  const last = Math.max(1, Math.ceil(total / pageSize))
  return page > last ? last : null
}

/**
 * Replaces the route with the last page when the requested one is past it, so a list never shows an empty page (and
 * hides its pagination) for a `?page=` the data no longer reaches. The other query parameters stay. `total` is
 * undefined until the list has loaded.
 */
export function useLastPageClamp(source: { page: () => number; total: () => number | undefined; pageSize: number }) {
  const route = useRoute()
  const router = useRouter()
  watch(() => { const total = source.total(); return total === undefined ? null : pageBeyondLast(source.page(), total, source.pageSize) }, (last) => {
    if (last !== null) void router.replace({ path: route.path, query: { ...route.query, page: last > 1 ? String(last) : undefined }, hash: route.hash })
  }, { immediate: true })
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
