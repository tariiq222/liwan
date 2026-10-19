import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/vue-query'
import {
  HrLeaveAllocationSchema,
  HrLeaveBalanceListSchema,
  HrLeaveListSchema,
  HrLeaveSchema,
  HrLeaveTypeListSchema,
  HrLeaveWithdrawalSchema,
  type HrLeave,
  type HrLeaveAllocationCreate,
  type HrLeaveRequestCreate,
  type HrLeaveState,
} from '@webvue/contracts'

export type { HrLeave }

/** `mine` lists the caller's own requests; `pending` and `all` are the approver's views. */
export type HrLeaveScope = 'mine' | 'pending' | 'all'

export interface HrLeaveListParams {
  scope: HrLeaveScope
  limit: number
  offset: number
}

export const hrLeaveKeys = {
  all: ['hr', 'leave'] as const,
  types: ['hr', 'leave', 'types'] as const,
  balances: (employeeId: number | null) => ['hr', 'leave', 'balances', employeeId] as const,
  requests: (params: HrLeaveListParams) => ['hr', 'leave', 'requests', params] as const,
  request: (id: number) => ['hr', 'leave', 'request', id] as const,
}

const SCOPE_STATE: Record<HrLeaveScope, HrLeaveState | undefined> = { mine: undefined, pending: 'confirm', all: undefined }

/** The query string of one scope: the caller's own list, the queue waiting for a decision, or every request. */
export function hrLeaveRequestQuery(params: HrLeaveListParams) {
  return {
    mine: params.scope === 'mine' ? '1' : undefined,
    state: SCOPE_STATE[params.scope],
    limit: params.limit,
    offset: params.offset,
  }
}

async function refreshLeave(qc: QueryClient) {
  await qc.invalidateQueries({ queryKey: hrLeaveKeys.all })
}

export function useHrLeaveTypes() {
  const { $api } = useApi()
  return useQuery({
    queryKey: hrLeaveKeys.types,
    queryFn: () => $api('/api/v1/hr/leave/types', { schema: HrLeaveTypeListSchema }),
  })
}

export function useHrLeaveBalances(employeeId: MaybeRefOrGetter<number | null> = null) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => hrLeaveKeys.balances(toValue(employeeId))),
    queryFn: () => $api('/api/v1/hr/leave/balances', {
      query: { employee_id: toValue(employeeId) ?? undefined },
      schema: HrLeaveBalanceListSchema,
    }),
  })
}

export function useHrLeaveRequests(params: MaybeRefOrGetter<HrLeaveListParams>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => hrLeaveKeys.requests(toValue(params))),
    queryFn: () => $api('/api/v1/hr/leave/requests', {
      query: hrLeaveRequestQuery(toValue(params)),
      schema: HrLeaveListSchema,
    }),
  })
}

export function useHrLeaveRequest(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => hrLeaveKeys.request(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    queryFn: () => $api(`/api/v1/hr/leave/requests/${toValue(id)}`, { schema: HrLeaveSchema }),
  })
}

export function useCreateLeaveRequest() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (body: HrLeaveRequestCreate) =>
      $api('/api/v1/hr/leave/requests', { method: 'POST', body, schema: HrLeaveSchema }),
    onSuccess: () => refreshLeave(qc),
  })
}

export type HrLeaveDecision = 'approve' | 'refuse' | 'cancel'

/** Withdrawing a pending request deletes it and the server confirms with the id. */
export function useWithdrawLeaveRequest() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (id: number) => $api(`/api/v1/hr/leave/requests/${id}/cancel`, {
      method: 'POST', body: {}, schema: HrLeaveWithdrawalSchema,
    }),
    onSuccess: () => refreshLeave(qc),
  })
}

/** A state change waits for the server: the list refreshes from its answer, never optimistically. */
export function useLeaveDecision() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, decision }: { id: number; decision: HrLeaveDecision }) =>
      $api(`/api/v1/hr/leave/requests/${id}/${decision}`, { method: 'POST', body: {}, schema: HrLeaveSchema }),
    onSuccess: () => refreshLeave(qc),
  })
}

export function useCreateLeaveAllocation() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (body: HrLeaveAllocationCreate) =>
      $api('/api/v1/hr/leave/allocations', { method: 'POST', body, schema: HrLeaveAllocationSchema }),
    onSuccess: () => refreshLeave(qc),
  })
}
