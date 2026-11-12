import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  MembershipInputSchema,
  MembershipListSchema,
  MembershipRolesInputSchema,
  MembershipSchema,
  type MembershipInput,
  type MembershipRolesInput,
} from '@liwan/contracts'
import { ACCESS_MUTATION_GC_TIME } from './useAdminUsers'

export const MEMBERSHIP_PAGE_SIZE = 200

/** The key names the signed-in company and the company the list belongs to, which differ when the root company manages a branch. */
export const membershipKeys = {
  all: ['access', 'memberships'] as const,
  list: (workingCompanyId: number | undefined, companyId: number | undefined) => ['access', 'memberships', workingCompanyId, companyId ?? workingCompanyId] as const,
}

/**
 * The members of a company whose home is another company. `companyId` names a branch below the working (root) company;
 * without it the list is the working company's.
 */
export function useMemberships(companyId: MaybeRefOrGetter<number | undefined>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => membershipKeys.list(me.value?.company.id, toValue(companyId))),
    enabled: computed(() => !!me.value && toValue(enabled)),
    queryFn: ({ signal }) => $api('/api/v1/admin/memberships', {
      query: { company_id: toValue(companyId), limit: MEMBERSHIP_PAGE_SIZE, offset: 0 },
      schema: MembershipListSchema,
      signal,
    }),
  })
}

/** A membership changes who may sign in to, and what is audited in, a company: refetch the lists, the access log and the identity. */
function useMembershipMutation<TVariables, TResult>(mutationFn: (variables: TVariables) => Promise<TResult>) {
  const queryClient = useQueryClient()
  return useMutation({
    gcTime: ACCESS_MUTATION_GC_TIME,
    mutationFn,
    onSuccess: async () => {
      await refreshNuxtData('me')
      await queryClient.invalidateQueries({ queryKey: membershipKeys.all })
      await queryClient.invalidateQueries({ queryKey: ['access', 'audit'] })
    },
  })
}

export function useAddMembership() {
  const { $api } = useApi()
  return useMembershipMutation((body: MembershipInput) =>
    $api('/api/v1/admin/memberships', { method: 'POST', body: MembershipInputSchema.parse(body), schema: MembershipSchema }))
}

export function useUpdateMembershipRoles() {
  const { $api } = useApi()
  return useMembershipMutation(({ id, body }: { id: number; body: MembershipRolesInput }) =>
    $api(`/api/v1/admin/memberships/${id}`, { method: 'PATCH', body: MembershipRolesInputSchema.parse(body), schema: MembershipSchema }))
}

export function useRemoveMembership() {
  const { $api } = useApi()
  return useMembershipMutation(({ id, companyId }: { id: number; companyId?: number }) =>
    $api(`/api/v1/admin/memberships/${id}`, { method: 'DELETE', query: { company_id: companyId } }))
}
