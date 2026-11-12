import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { AccessPolicyPatchSchema, AccessPolicySchema, type AccessPolicyPatch } from '@liwan/contracts'

export function useAccessPolicy(enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => ['access', 'policy', me.value?.id, me.value?.company.id]),
    enabled: computed(() => !!me.value && toValue(enabled)),
    queryFn: ({ signal }) => $api('/api/v1/admin/access/policy', { schema: AccessPolicySchema, signal }),
  })
}

export function useUpdateAccessPolicy() {
  const { $api } = useApi()
  const { me } = useMe()
  const queryClient = useQueryClient()
  return useMutation({
    gcTime: 0,
    mutationFn: (body: AccessPolicyPatch) => $api('/api/v1/admin/access/policy', { method: 'PATCH', body: AccessPolicyPatchSchema.parse(body), schema: AccessPolicySchema }),
    onSuccess: policy => queryClient.setQueryData(['access', 'policy', me.value?.id, me.value?.company.id], policy),
  })
}
