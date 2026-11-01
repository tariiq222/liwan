import { ApiError } from './useApi'
import { useHrOwnIdentity } from './useHrOwnIdentity'
import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/vue-query'
import {
  HrLeaveAllocationListSchema,
  HrLeaveApprovalProcessSchema,
  HrLeaveApprovalSchema,
  HrLeaveAllocationSchema,
  HrLeaveBalanceListSchema,
  HrLeaveListSchema,
  HrLeaveSchema,
  HrLeaveTypeListSchema,
  HrLeaveWithdrawalSchema,
  type HrLeave,
  type HrLeaveAllocation,
  type HrLeaveAllocationCreate,
  type HrLeaveAllocationPatch,
  type HrLeaveRequestCreate,
  type HrLeaveState,
} from '@liwan/contracts'

export type { HrLeave, HrLeaveAllocation }

/** `mine` lists the caller's own requests; `pending` and `all` are the approver's views. */
export type HrLeaveScope = 'mine' | 'pending' | 'all'

export interface HrLeaveListParams {
  scope: HrLeaveScope
  limit: number
  offset: number
  cancellation_state?: 'pending'
}

export interface HrLeaveAllocationListParams {
  limit: number
  offset: number
}

export const hrLeaveKeys = {
  all: ['hr', 'leave'] as const,
  types: ['hr', 'leave', 'types'] as const,
  balances: (employeeId: number | null) => ['hr', 'leave', 'balances', employeeId] as const,
  requests: (params: HrLeaveListParams) => ['hr', 'leave', 'requests', params] as const,
  ownRequest: (id: number) => ['hr', 'leave', 'me', id] as const,
  request: (id: number) => ['hr', 'leave', 'request', id] as const,
  approval: (id: number) => ['hr', 'leave', 'approval', id] as const,
  approvalProcess: ['hr', 'leave', 'approval-process'] as const,
  allocations: (params: HrLeaveAllocationListParams) => ['hr', 'leave', 'allocations', params] as const,
  allocation: (id: number) => ['hr', 'leave', 'allocation', id] as const,
}

/** The pending queue is every request still waiting for a decision: first and second approval. */
export const HR_LEAVE_PENDING_STATES: readonly HrLeaveState[] = ['confirm', 'validate1']
const SCOPE_STATE: Record<HrLeaveScope, string | undefined> = { mine: undefined, pending: HR_LEAVE_PENDING_STATES.join(','), all: undefined }

/** The query string of one scope: the caller's own list, the queue waiting for a decision, or every request. */
export function hrLeaveRequestQuery(params: HrLeaveListParams) {
  return {
    mine: params.scope === 'mine' ? '1' : undefined,
    state: params.cancellation_state ? undefined : SCOPE_STATE[params.scope],
    cancellation_state: params.cancellation_state,
    limit: params.limit,
    offset: params.offset,
  }
}

async function refreshLeave(qc: QueryClient) {
  await qc.invalidateQueries({ queryKey: hrLeaveKeys.all })
}

export function useHrLeaveTypes(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: hrLeaveKeys.types,
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/hr/leave/types', { schema: HrLeaveTypeListSchema }),
  })
}

export function useHrLeaveBalances(employeeId: MaybeRefOrGetter<number | null> = null, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const identity = useHrOwnIdentity()
  return useQuery({
    queryKey: computed(() => toValue(employeeId) === null ? [...hrLeaveKeys.balances(null), identity.scope.value] : hrLeaveKeys.balances(toValue(employeeId))),
    enabled: computed(() => toValue(enabled) && (toValue(employeeId) !== null || identity.ready.value)),
    queryFn: () => $api('/api/v1/hr/leave/balances', {
      query: { employee_id: toValue(employeeId) ?? undefined },
      schema: HrLeaveBalanceListSchema,
    }),
  })
}

export function useHrLeaveRequests(params: MaybeRefOrGetter<HrLeaveListParams>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const identity = useHrOwnIdentity()
  return useQuery({
    queryKey: computed(() => toValue(params).scope === 'mine' ? [...hrLeaveKeys.requests(toValue(params)), identity.scope.value] : hrLeaveKeys.requests(toValue(params))),
    enabled: computed(() => toValue(enabled) && (toValue(params).scope !== 'mine' || identity.ready.value)),
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

/** The approval stages of a leave the operations workflow governs; a 404 means it is not governed, so the page shows nothing. */
export function useHrLeaveApproval(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => hrLeaveKeys.approval(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
    queryFn: () => $api(`/api/v1/hr/leave/requests/${toValue(id)}/approval`, { schema: HrLeaveApprovalSchema }),
  })
}

/** The company's leave approval process; a 404 (no bridge) or 403 means the settings page shows no card. */
export function useHrLeaveApprovalProcess(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => [...hrLeaveKeys.approvalProcess, { companyId: me.value?.company?.id, userId: me.value?.id }]),
    enabled: computed(() => toValue(enabled) && !!me.value),
    retry: (count, error) => !(error instanceof ApiError && (error.status === 404 || error.status === 403)) && count < 2,
    queryFn: () => $api('/api/v1/hr/leave/approval-process', { schema: HrLeaveApprovalProcessSchema }),
  })
}

/** Create the default process (manager, then HR) when the company has none. */
export function useCreateDefaultLeaveApprovalProcess() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: () => $api('/api/v1/hr/leave/approval-process/default', { method: 'POST', body: {}, schema: HrLeaveApprovalProcessSchema }),
    onSuccess: () => refreshLeave(qc),
  })
}

/** Own record reads never fall back to the administrative endpoint, even for approvers. */
export function useMyHrLeaveRequest(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  const identity = useHrOwnIdentity()
  return useQuery({
    queryKey: computed(() => [...hrLeaveKeys.ownRequest(toValue(id) ?? 0), identity.scope.value]),
    enabled: computed(() => identity.ready.value && !!toValue(id)),
    queryFn: () => $api(`/api/v1/hr/leave/me/${toValue(id)}`, { schema: HrLeaveSchema }),
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
    mutationFn: ({ id, decision, reason, revision }: { id: number; decision: HrLeaveDecision; reason?: string; revision?: number }) =>
      $api(`/api/v1/hr/leave/requests/${id}/${decision}`, { method: 'POST', body: { ...(reason ? { reason } : {}), ...(revision ? { revision } : {}) }, schema: HrLeaveSchema }),
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

/** The grants of the companies where the caller manages leave, newest validity first.
 *  The page passes its own hr.leave.manage check as `enabled`: the HR attention provider imports
 *  this module, so it must not reach the access layer itself. */
export function useHrLeaveAllocations(params: MaybeRefOrGetter<HrLeaveAllocationListParams>, enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => hrLeaveKeys.allocations(toValue(params))),
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/hr/leave/allocations', { query: { ...toValue(params) }, schema: HrLeaveAllocationListSchema }),
  })
}

export function useHrLeaveAllocation(id: MaybeRefOrGetter<number | null>, enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => hrLeaveKeys.allocation(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id) && toValue(enabled)),
    queryFn: () => $api(`/api/v1/hr/leave/allocations/${toValue(id)}`, { schema: HrLeaveAllocationSchema }),
  })
}

export function useUpdateLeaveAllocation() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: HrLeaveAllocationPatch }) =>
      $api(`/api/v1/hr/leave/allocations/${id}`, { method: 'PATCH', body: patch, schema: HrLeaveAllocationSchema }),
    onSuccess: async (allocation) => {
      qc.setQueryData(hrLeaveKeys.allocation(allocation.id), allocation)
      await refreshLeave(qc)
    },
  })
}

/** Revoke a grant through hr_holidays' refusal; refused while validated leave still consumes its days. */
export function useRevokeLeaveAllocation() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (id: number) =>
      $api(`/api/v1/hr/leave/allocations/${id}/revoke`, { method: 'POST', body: {}, schema: HrLeaveAllocationSchema }),
    onSuccess: async (allocation) => {
      qc.setQueryData(hrLeaveKeys.allocation(allocation.id), allocation)
      await refreshLeave(qc)
    },
  })
}

/** Cancellation decisions carry the observed aggregate revision and await native execution. */
export function useCancellationDecision() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, decision, revision, reason }: { id: number; decision: 'approve' | 'refuse'; revision: number; reason?: string }) =>
      $api(`/api/v1/hr/leave/requests/${id}/cancellation/${decision}`, { method: 'POST', body: { revision, ...(reason ? { reason } : {}) }, schema: HrLeaveSchema }),
    onSuccess: () => refreshLeave(qc),
  })
}
