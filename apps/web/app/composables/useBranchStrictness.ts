import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { BranchStrictnessSchema, BranchStrictnessInputSchema, type BranchStrictnessInput } from '@liwan/contracts'

// «Stricter than the general policy» of one application: read and written at that application's own route.
export function useBranchStrictness(path: string, enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => ['access', 'branch-strictness', path, me.value?.id, me.value?.company.id]),
    enabled: computed(() => !!me.value && toValue(enabled)),
    queryFn: ({ signal }) => $api(path, { schema: BranchStrictnessSchema, signal }),
  })
}

export function useUpdateBranchStrictness(path: string) {
  const { $api } = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    gcTime: 0,
    mutationFn: (body: BranchStrictnessInput) => $api(path, { method: 'PATCH', body: BranchStrictnessInputSchema.parse(body), schema: BranchStrictnessSchema }),
    // Branch visibility changes at once, so no cached branch list may outlive the switch.
    onSuccess: () => queryClient.invalidateQueries(),
  })
}
