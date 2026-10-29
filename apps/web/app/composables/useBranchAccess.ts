import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  BranchPolicySchema, BranchPolicyInputSchema, UserBranchAccessSchema, UserBranchAccessInputSchema,
  type BranchPolicyInput, type UserBranchAccessInput,
} from '@webvue/contracts'
import { accessRefreshWait, refreshMeInNuxtContext } from './useAdminUsers'

export function useBranchPolicy(enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => ['access', 'branch-policy', me.value?.id, me.value?.company.id]),
    enabled: computed(() => !!me.value && toValue(enabled)),
    queryFn: ({ signal }) => $api('/api/v1/admin/access/branches', { schema: BranchPolicySchema, signal }),
  })
}

export function useUserBranchAccess(id: MaybeRefOrGetter<number>, enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => ['access', 'branch-delegation', me.value?.id, me.value?.company.id, toValue(id)]),
    enabled: computed(() => !!me.value && toValue(enabled) && Number.isSafeInteger(toValue(id)) && toValue(id) > 0),
    queryFn: ({ signal }) => $api(`/api/v1/admin/users/${toValue(id)}/branches`, { schema: UserBranchAccessSchema, signal }),
  })
}

// Both operations can revoke the current user's effective access. Refresh identity
// before refetching data, so a cached branch list cannot outlive the new policy.
export function branchMutationRefresh() {
  const nuxt = useNuxtApp()
  const queryClient = useQueryClient()
  return async () => {
    await refreshMeInNuxtContext(nuxt, () => refreshNuxtData('me'))
    const wait = accessRefreshWait(nuxt)
    if (wait) await wait()
    await queryClient.invalidateQueries()
  }
}

export function useUpdateBranchPolicy() {
  const { $api } = useApi()
  const refresh = branchMutationRefresh()
  return useMutation({
    gcTime: 0,
    mutationFn: (body: BranchPolicyInput) => $api('/api/v1/admin/access/branches', { method: 'PATCH', body: BranchPolicyInputSchema.parse(body), schema: BranchPolicySchema }),
    onSuccess: refresh,
  })
}

export function useUpdateUserBranchAccess(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const refresh = branchMutationRefresh()
  return useMutation({
    gcTime: 0,
    mutationFn: (body: UserBranchAccessInput) => $api(`/api/v1/admin/users/${toValue(id)}/branches`, { method: 'PATCH', body: UserBranchAccessInputSchema.parse(body), schema: UserBranchAccessSchema }),
    onSuccess: refresh,
  })
}
