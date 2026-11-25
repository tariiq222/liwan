import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { operationKpiQueryParams, operationKpiStates, operationKpiTiles } from './kpis'
import type { OperationPurpose } from '@liwan/contracts'
import { useOperationRequests, type OperationScope } from './useOperations'

// Every count is the `total` of the list API (`/operations/requests`) asked for one row with the tile's state, under the
// page's own scope, type filter and search, never a sum over the loaded page.

/** The tiles of one operations request list; `enabled` is the page's capability check (and KPI visibility), so a forbidden or hidden list asks nothing. */
export function useOperationKpis(
  scope: OperationScope,
  search: MaybeRefOrGetter<string | undefined>,
  purpose: MaybeRefOrGetter<OperationPurpose | undefined>,
  enabled: MaybeRefOrGetter<boolean>,
  personal = false,
) {
  const { t } = useI18n()
  const effectiveScope: OperationScope = personal ? 'mine' : scope
  const queries = Object.fromEntries(Object.entries(operationKpiStates[effectiveScope]).map(([id, state]) => [
    id,
    useOperationRequests(() => operationKpiQueryParams(effectiveScope, state, toValue(search) || undefined, toValue(purpose), personal), enabled),
  ]))
  const tiles = computed(() => operationKpiTiles(
    effectiveScope,
    Object.fromEntries(Object.entries(queries).map(([id, query]) => [id, query.data.value?.total])),
    t,
    toValue(search) || undefined,
    personal ? undefined : toValue(purpose),
    personal,
  ))
  const loading = computed(() => Object.values(queries).some(query => query.isLoading.value))
  return { tiles, loading }
}
