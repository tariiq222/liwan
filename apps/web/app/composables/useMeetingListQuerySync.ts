import { onScopeDispose, watch, type Ref } from 'vue'
import type { LocationQueryRaw, RouteLocationNormalized, RouteLocationNormalizedLoaded, Router } from 'vue-router'
import { parseMeetingListFilters, patchMeetingListQuery, type MeetingFilterPatch } from '../utils/meetingListFilters'
import { parseOffset } from '../utils/routeQuery'

type ListFilters = ReturnType<typeof parseMeetingListFilters>

type PendingQuery = { id: number; query: LocationQueryRaw; fullPath: string; navigation: RouteLocationNormalized | null }

export interface MeetingListQuerySyncOptions {
  router: Router
  route: RouteLocationNormalizedLoaded
  listPath: string
  search: Ref<string>
  debouncedSearch: Ref<string>
  offset: Ref<number>
  /** Page-owned filters that are ahead of the route query, as a patch of the current query. */
  livePatch?: (current: ListFilters) => MeetingFilterPatch
  /** Copies the page-owned filters of a committed list route into local state. */
  syncFromRoute?: (to: RouteLocationNormalized) => void
  /** Subscribes to the start of every navigation and returns its unsubscribe function. */
  onNavigationStart: (handler: (to: RouteLocationNormalized) => void) => () => void
}

/**
 * Keeps a meeting list's search box, offset and filters in step with the router's query without
 * losing the user's draft: own `router.replace` writes are tracked, a navigation away from the
 * list never gets a search write racing it, and an external list navigation wins over a pending write.
 */
export function useMeetingListQuerySync(options: MeetingListQuerySyncOptions) {
  const { router, route, listPath, search, debouncedSearch, offset, livePatch, syncFromRoute, onNavigationStart } = options
  let pendingNavigation: RouteLocationNormalized | null = null
  let ownWrites = 0
  let disposed = false
  let writeId = 0
  let pendingQuery: PendingQuery | null = null

  const isCurrentList = () => router.currentRoute.value.path.replace(/\/+$/, '') === listPath

  function currentListQuery() {
    return pendingQuery?.query ?? router.currentRoute.value.query
  }
  function liveListQuery() {
    const query = currentListQuery()
    const current = parseMeetingListFilters(query)
    const patch: MeetingFilterPatch = { ...livePatch?.(current) }
    if (search.value.trim() !== current.q) patch.q = search.value.trim() || undefined
    return Object.keys(patch).length ? patchMeetingListQuery(query, patch) : query
  }
  function liveReturnTo() {
    return router.resolve({ path: listPath, query: liveListQuery(), hash: router.currentRoute.value.hash }).fullPath
  }
  function writeSearch() {
    if (disposed || pendingNavigation || ownWrites || !isCurrentList()) return
    if (search.value.trim() === parseMeetingListFilters(router.currentRoute.value.query).q) return
    void replaceListQuery(liveListQuery())
  }
  function syncListState(to: RouteLocationNormalized) {
    search.value = parseMeetingListFilters(to.query).q
    offset.value = parseOffset(to.query.offset)
    syncFromRoute?.(to)
  }
  async function replaceListQuery(query: LocationQueryRaw) {
    if (disposed || !isCurrentList()) return
    const id = ++writeId
    const searchAtStart = search.value
    const routeAtStart = router.currentRoute.value
    pendingQuery = { id, query, fullPath: router.resolve({ path: listPath, query, hash: routeAtStart.hash }).fullPath, navigation: null }
    ownWrites++
    let succeeded = false
    try {
      succeeded = !(await router.replace({ path: listPath, query, hash: routeAtStart.hash }))
    } catch {
      // Router errors leave the draft available for a later human edit.
    } finally {
      ownWrites--
      const ownsDraft = pendingQuery?.id === id
      if (ownsDraft) pendingQuery = null
      if (!disposed) {
        if (!ownWrites && ownsDraft && id === writeId && !succeeded && router.currentRoute.value !== routeAtStart && isCurrentList()) {
          syncListState(router.currentRoute.value)
        } else if (!ownWrites && search.value !== searchAtStart && debouncedSearch.value === search.value) {
          writeSearch()
        }
      }
    }
  }

  const stopNavigationStart = onNavigationStart(to => {
    pendingNavigation = to
    // Capture the first actual router target for this writer before auth awaits.
    // A later human navigation may resolve to the same URL with another identity.
    if (pendingQuery && !pendingQuery.navigation && to.fullPath === pendingQuery.fullPath) pendingQuery.navigation = to
  })
  const stopAfterEach = router.afterEach((to, _from, failure) => {
    if (to !== pendingNavigation) return
    pendingNavigation = null
    // A refused own query finishes its promise without requeueing itself.
    if (ownWrites) {
      // A newer external list owns its query even before the old writer settles.
      // Drop that writer's draft before route-driven date watchers can reuse it.
      if (!failure && isCurrentList() && to !== pendingQuery?.navigation) {
        pendingQuery = null
        syncListState(to)
      }
      return
    }
    if (failure) writeSearch()
    else if (isCurrentList()) syncListState(to)
  })
  const stopOnError = router.onError((_error, to) => {
    if (to !== pendingNavigation) return
    pendingNavigation = null
    if (!ownWrites) writeSearch()
  })
  onScopeDispose(() => { disposed = true; stopNavigationStart(); stopAfterEach(); stopOnError() })

  watch(() => route.query.q, value => {
    if (ownWrites || !isCurrentList() || value !== router.currentRoute.value.query.q) return
    const next = typeof value === 'string' ? value : ''
    if (next !== search.value) search.value = next
  })
  watch(() => route.query.offset, value => {
    const next = parseOffset(value)
    if (next !== offset.value) offset.value = next
  })
  watch(debouncedSearch, () => { writeSearch() })

  function isPlainClick(event: MouseEvent) {
    return event.button === 0 && !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
  }

  return { isCurrentList, currentListQuery, liveListQuery, liveReturnTo, replaceListQuery, isPlainClick }
}
