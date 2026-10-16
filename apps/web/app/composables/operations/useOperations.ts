import { computed, onServerPrefetch, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { OperationExecutionKindsSchema, OperationTargetsSchema, OperationProcessListSchema, OperationProcessSchema, OperationRequestListSchema, OperationRequestSchema } from '@webvue/contracts'
import { useApi } from '../useApi'
import { operationProcessMutationOptions, operationRequestMutationOptions, type OperationApi } from './mutations'

export type OperationScope = 'mine' | 'pending' | 'monitoring'
function prefetch(query: { suspense: () => Promise<unknown> }, enabled: MaybeRefOrGetter<boolean>) {
  onServerPrefetch(async () => { if (toValue(enabled)) { try { await query.suspense() } catch { /* Query renders structured read errors. */ } } })
}
export function useOperationRequests(params: MaybeRefOrGetter<{ scope: OperationScope; q?: string; state?: string; limit?: number; offset?: number }>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const query = useQuery({
    queryKey: computed(() => ['operations', 'requests', 'list', toValue(params)]), enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/operations/requests', { query: toValue(params), schema: OperationRequestListSchema }),
  })
  prefetch(query, enabled)
  return query
}
export function useOperationProcesses(params: MaybeRefOrGetter<{ published?: number; q?: string; limit?: number; offset?: number }> = {}, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const query = useQuery({
    queryKey: computed(() => ['operations', 'processes', 'list', toValue(params)]), enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/operations/processes', { query: toValue(params), schema: OperationProcessListSchema }),
  })
  prefetch(query, enabled)
  return query
}
export function useOperationRequest(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  const enabled = computed(() => toValue(id) !== null)
  const query = useQuery({ queryKey: computed(() => ['operations', 'requests', 'detail', toValue(id)]), enabled, queryFn: () => $api(`/api/v1/operations/requests/${toValue(id)}`, { schema: OperationRequestSchema }) })
  prefetch(query, enabled)
  return query
}
export function useOperationProcess(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  const enabled = computed(() => toValue(id) !== null)
  const query = useQuery({ queryKey: computed(() => ['operations', 'processes', 'detail', toValue(id)]), enabled, queryFn: () => $api(`/api/v1/operations/processes/${toValue(id)}`, { schema: OperationProcessSchema }) })
  prefetch(query, enabled)
  return query
}
export function useOperationRequestMutation() {
  const { $api } = useApi()
  return useMutation(operationRequestMutationOptions($api, useQueryClient()))
}
export function useOperationProcessMutation() {
  const { $api } = useApi()
  return useMutation(operationProcessMutationOptions($api, useQueryClient()))
}

export function useOperationExecutionKinds() {
  const { $api } = useApi()
  return useQuery({ queryKey: ['operations', 'execution-kinds'], queryFn: () => $api('/api/v1/operations/execution-kinds', { schema: OperationExecutionKindsSchema }) })
}
export function operationTargetQueryOptions(api: OperationApi, id: MaybeRefOrGetter<number | null>, enabled: MaybeRefOrGetter<boolean>, q: MaybeRefOrGetter<string> = '') {
  return {
    queryKey: computed(() => ['operations', 'targets', toValue(id), toValue(q).trim()]),
    enabled: computed(() => toValue(id) !== null && toValue(enabled)),
    queryFn: () => api(`/api/v1/operations/processes/${toValue(id)}/targets`, { query: { q: toValue(q).trim() || undefined }, schema: OperationTargetsSchema }),
  }
}
export function useOperationTargets(id: MaybeRefOrGetter<number | null>, enabled: MaybeRefOrGetter<boolean>, q: MaybeRefOrGetter<string> = '') {
  const { $api } = useApi()
  return useQuery(operationTargetQueryOptions($api, id, enabled, q))
}
