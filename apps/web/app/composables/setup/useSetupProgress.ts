import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { SetupProgressSchema, type SetupProgressChange } from '@liwan/contracts'

const ROUTE = '/api/v1/setup/progress'
/** The wizard belongs to the working company; each company keeps its own cache entry. */
export const setupProgressKey = (companyId: number | undefined) => ['setup', 'progress', { companyId }] as const

/** A branch or a user without the capability gets a refusal; callers treat an error as "no wizard" and show nothing. */
export function useSetupProgress(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => setupProgressKey(me.value?.company?.id)),
    enabled: computed(() => toValue(enabled) && !!me.value),
    queryFn: ({ signal }) => $api(ROUTE, { schema: SetupProgressSchema, signal }),
    retry: false,
  })
}

/** One change (a step's outcome, or closing or reopening); the server's answer replaces the cached progress. */
export function useChangeSetupProgress() {
  const { $api } = useApi()
  const { me } = useMe()
  const queryClient = useQueryClient()
  return useMutation({
    gcTime: 0,
    mutationFn: (change: SetupProgressChange) => $api(ROUTE, { method: 'PUT', body: change, schema: SetupProgressSchema }),
    onSuccess: progress => queryClient.setQueryData(setupProgressKey(me.value?.company?.id), progress),
  })
}
