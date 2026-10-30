import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { MyTaskListPageSchema } from '@liwan/contracts'
import { myTaskListQuery, type MyTaskListParams } from './useMyTasks'
import { myTaskKeys } from './myTaskKeys'
import { MY_TASK_PAGE_SIZE } from '@/utils/myTaskList'

export function useMyTaskList(params: MaybeRefOrGetter<MyTaskListParams>) {
  const { $api } = useApi()
  const query = computed(() => myTaskListQuery({ ...toValue(params), limit: MY_TASK_PAGE_SIZE }))
  return useQuery({
    queryKey: computed(() => myTaskKeys.list(query.value)),
    queryFn: () => $api('/api/v1/my-tasks', { query: query.value, schema: MyTaskListPageSchema }),
  })
}
