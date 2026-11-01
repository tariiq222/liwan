import { computed, onServerPrefetch, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { OperationExecutionKindsSchema, OperationReviewerResolversSchema, OperationTargetsSchema, OperationProcessListSchema, OperationProcessSchema, OperationRequestListSchema, OperationRequestSchema, type OperationPurpose } from '@liwan/contracts'
import { useApi } from '../useApi'
import { operationProcessMutationOptions, operationRequestMutationOptions, type OperationApi } from './mutations'

export type OperationScope = 'mine' | 'pending' | 'monitoring'
// The personal surface and «طلباتي» have a fixed purpose; the shared review and monitoring lists filter by the type the user picks.
export function operationRequestListParams(scope: OperationScope, personal = false, purpose?: OperationPurpose): { scope: OperationScope; purpose?: OperationPurpose } {
  if (personal) return { scope: 'mine', purpose: 'employee' }
  if (scope === 'mine') return { scope, purpose: 'work' }
  return purpose ? { scope, purpose } : { scope }
}
function prefetch(query: { suspense: () => Promise<unknown> }, enabled: MaybeRefOrGetter<boolean>) {
  onServerPrefetch(async () => { if (toValue(enabled)) { try { await query.suspense() } catch { /* Query renders structured read errors. */ } } })
}
export function useOperationRequests(params: MaybeRefOrGetter<{ scope: OperationScope; purpose?: 'work' | 'employee'; q?: string; state?: string; limit?: number; offset?: number }>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { me } = useMe()
  const query = useQuery({
    queryKey: computed(() => ['operations', 'requests', 'list', toValue(params), me.value?.company.id, me.value?.id]), enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/operations/requests', { query: toValue(params), schema: OperationRequestListSchema }),
  })
  prefetch(query, enabled)
  return query
}
export function useOperationProcesses(params: MaybeRefOrGetter<{ published?: number; requestable?: number; purpose?: 'work' | 'employee'; q?: string; limit?: number; offset?: number }> = {}, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const query = useQuery({
    queryKey: computed(() => ['operations', 'processes', 'list', toValue(params)]), enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/operations/processes', { query: toValue(params), schema: OperationProcessListSchema }),
  })
  prefetch(query, enabled)
  return query
}
export function operationRequestQueryOptions(api: OperationApi, id: MaybeRefOrGetter<number | null>, personal: boolean, identity: MaybeRefOrGetter<{ id: number; company: { id: number } } | null>) {
  return {
    queryKey: computed(() => personal ? ['operations', 'requests', 'personal', toValue(identity)?.company.id, toValue(identity)?.id, toValue(id)] : ['operations', 'requests', 'detail', toValue(id)]),
    enabled: computed(() => toValue(id) !== null && (!personal || !!toValue(identity))),
    queryFn: () => api(`/api/v1/operations/requests/${personal ? 'employee/me/' : ''}${toValue(id)}`, { schema: OperationRequestSchema }),
  }
}
export function useOperationRequest(id: MaybeRefOrGetter<number | null>, personal = false) {
  const { $api } = useApi()
  const { me } = useMe()
  const options = operationRequestQueryOptions($api, id, personal, me)
  const query = useQuery(options)
  prefetch(query, options.enabled)
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
export function useOperationReviewerResolvers(executionKind: MaybeRefOrGetter<string>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => ['operations', 'reviewer-resolvers', toValue(executionKind)]),
    queryFn: () => $api('/api/v1/operations/processes/reviewer-resolvers', { query: { execution_kind: toValue(executionKind) }, schema: OperationReviewerResolversSchema }),
  })
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
