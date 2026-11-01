import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  BaselineVarianceSchema, ProjectBaselineDetailSchema, ProjectBaselineListSchema, type ProjectBaselineWrite,
} from '@liwan/contracts'
import { projectKeys } from './projectKeys'
import { BASELINE_PAGE, baselineKeys } from './projectBaselineKeys'

export function useProjectBaselines(projectId: MaybeRefOrGetter<number | null>, offset: MaybeRefOrGetter<number> = 0) {
  const { $api } = useApi()
  const query = computed(() => ({ limit: BASELINE_PAGE, offset: toValue(offset) }))
  return useQuery({
    queryKey: computed(() => baselineKeys.list(toValue(projectId) ?? 0, query.value)),
    enabled: computed(() => !!toValue(projectId)),
    queryFn: () => $api(`/api/v1/projects/${toValue(projectId)}/baselines`, { query: query.value, schema: ProjectBaselineListSchema }),
  })
}

export function useProjectBaseline(projectId: MaybeRefOrGetter<number | null>, number: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => baselineKeys.item(toValue(projectId) ?? 0, toValue(number) ?? 0)),
    enabled: computed(() => !!toValue(projectId) && !!toValue(number)),
    queryFn: () => $api(`/api/v1/projects/${toValue(projectId)}/baselines/${toValue(number)}`, { schema: ProjectBaselineDetailSchema }),
  })
}

/** Variance against the latest baseline; `baseline` is null until one is taken. Read-only and computed on the server. */
export function useBaselineVariance(projectId: MaybeRefOrGetter<number | null>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => baselineKeys.variance(toValue(projectId) ?? 0)),
    enabled: computed(() => !!toValue(projectId) && toValue(enabled)),
    queryFn: () => $api(`/api/v1/projects/${toValue(projectId)}/baselines/variance`, { schema: BaselineVarianceSchema }),
  })
}

export function useTakeBaseline() {
  const qc = useQueryClient(); const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, body }: { projectId: number; body: ProjectBaselineWrite }) =>
      $api(`/api/v1/projects/${projectId}/baselines`, { method: 'POST', body, schema: ProjectBaselineDetailSchema }),
    // A new baseline moves the gate check of the phase card and every variance, so the project's own cache is refreshed too.
    onSuccess: (_baseline, { projectId }) => Promise.all([
      qc.invalidateQueries({ queryKey: baselineKeys.all(projectId) }),
      qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) }),
    ]),
  })
}
