import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { MyTaskSummarySchema } from '@webvue/contracts'
import { myTaskListQuery, type MyTaskListParams } from './useMyTasks'
import { myTaskKeys } from './myTaskKeys'

/** The KPI counts for the list's scope and search; the open/closed tab, sort and paging do not apply. */
export function useMyTaskSummary(params: MaybeRefOrGetter<Pick<MyTaskListParams, 'q' | 'scope'>>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const query = computed(() => {
    const { q, assigned, created } = myTaskListQuery(toValue(params))
    return { q, assigned, created }
  })
  return useQuery({
    queryKey: computed(() => myTaskKeys.summary(query.value)),
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/my-tasks/summary', { query: query.value, schema: MyTaskSummarySchema }),
  })
}
