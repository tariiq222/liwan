import { computed, watch, type ComputedRef, type Ref } from 'vue'
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'
import { nextOffsetAfterListResult } from '../../../../utils/projectFinance'

export const GOVERNANCE_PAGE = 50

/**
 * The `?offset=` paging of a governance list (register, stakeholders): the page number, the page count, a page setter
 * that pushes the offset, and a clamp that moves an offset past the last page back onto it once the server has answered.
 */
export function useGovernancePaging(
  list: { data: Ref<{ total: number } | undefined>; isFetching: Ref<boolean> },
  offset: ComputedRef<number>,
  active: ComputedRef<boolean>,
  context: { route: RouteLocationNormalizedLoaded; router: Router; hydrated: Ref<boolean> },
) {
  const { route, router, hydrated } = context
  const pageNumber = computed(() => Math.floor(offset.value / GOVERNANCE_PAGE) + 1)
  const pages = computed(() => Math.max(1, pageNumber.value, Math.ceil((list.data.value?.total ?? 0) / GOVERNANCE_PAGE)))
  const offsetQuery = (value: number) => (value > 0 ? String(value) : undefined)

  function setPage(next: number) {
    if (!hydrated.value || list.isFetching.value || next < 1 || next > pages.value) return
    void router.push({ query: { ...route.query, offset: offsetQuery((next - 1) * GOVERNANCE_PAGE) } })
  }

  watch(() => ({ fetching: list.isFetching.value, offset: offset.value, total: list.data.value?.total }), ({ fetching, offset: requested, total }) => {
    if (!active.value) return
    const next = nextOffsetAfterListResult({ isFetching: fetching, requestedOffset: requested, responseOffset: requested, total, pageSize: GOVERNANCE_PAGE })
    if (next !== null) void router.replace({ query: { ...route.query, offset: offsetQuery(next) } })
  }, { immediate: true })

  return { pageNumber, pages, setPage }
}
