import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import { listFilterQuery } from '@/composables/useRouteListFilters'

/** `safeReturnTo` for one list: only that list's own path (and its query) is an acceptable origin. */
export const listReturnTo = (listPath: string) => (value: unknown, fallback: string) => safeReturnTo(value, fallback, [listPath])

/** The filters a list reads: its own query, or the query carried in its create panel's returnTo when it is the backdrop. */
export function useListFilterQuery(listPath: string, background: boolean | undefined) {
  const route = useRoute()
  return computed(() => listFilterQuery(route.query, !!background, listPath, listReturnTo(listPath)))
}

/** Where a record or a create panel opened from this list returns to: the list with the filters it shows now. */
export function useListLocation(listPath: string, background: boolean | undefined) {
  const route = useRoute()
  const router = useRouter()
  return computed(() => background && typeof route.query.returnTo === 'string'
    ? safeReturnTo(route.query.returnTo, listPath, [listPath])
    : router.resolve({ path: listPath, query: route.query }).fullPath)
}
