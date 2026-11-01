import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { ProjectEvmSchema } from '@liwan/contracts'
import { projectKeys } from './projectKeys'

/** Earned value of the project against its latest baseline, as of today; a project without a baseline answers 409 `no_baseline`. */
export function useProjectEvm(projectId: MaybeRefOrGetter<number | null>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    // Under the project's own cache root, so a task write that refreshes the project refreshes this reading too.
    queryKey: computed(() => [...projectKeys.detail(toValue(projectId) ?? 0), 'evm'] as const),
    enabled: computed(() => !!toValue(projectId) && toValue(enabled)),
    queryFn: () => $api(`/api/v1/projects/${toValue(projectId)}/evm`, { schema: ProjectEvmSchema }),
    retry: false,
  })
}
