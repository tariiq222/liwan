import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { operationKpiStates, operationKpiTiles } from './kpis'
import type { OperationPurpose } from '@webvue/contracts'
import { useOperationRequests, operationRequestListParams, type OperationScope } from './useOperations'

// Every count is the `total` of the list API (`/operations/requests`) asked for one row with the tile's state, under the
// page's own scope, type filter and search, never a sum over the loaded page.

/** The tiles of one operations request list; `enabled` is the page's capability check, so a forbidden list asks nothing. */
export function useOperationKpis(scope: OperationScope, search: MaybeRefOrGetter<string | undefined>, purpose: MaybeRefOrGetter<OperationPurpose | undefined>, enabled: MaybeRefOrGetter<boolean>) {
  const { t } = useI18n()
  const queries = Object.fromEntries(Object.entries(operationKpiStates[scope]).map(([id, state]) => [
    id,
    useOperationRequests(() => ({ ...operationRequestListParams(scope, false, toValue(purpose)), q: toValue(search) || undefined, state, limit: 1 }), enabled),
  ]))
  const tiles = computed(() => operationKpiTiles(scope, Object.fromEntries(Object.entries(queries).map(([id, query]) => [id, query.data.value?.total])), t, toValue(search) || undefined))
  const loading = computed(() => Object.values(queries).some(query => query.isLoading.value))
  return { tiles, loading }
}
