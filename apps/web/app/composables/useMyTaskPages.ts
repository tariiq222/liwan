import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useInfiniteQuery } from '@tanstack/vue-query'
import { MyTaskListPageSchema } from '@nasq/contracts'
import { myTaskListQuery, type MyTaskListParams } from './useMyTasks'
import { myTaskKeys } from './myTaskKeys'
import { MY_TASK_PAGE_SIZE, nextOffset } from '@/utils/myTaskList'

// The paged list of my tasks: it lives under the `lists` key prefix, so every write that
// invalidates the lists refreshes it too. Pages are fetched by `offset + limit`, never by row count.
export function useMyTaskPages(params: MaybeRefOrGetter<Omit<MyTaskListParams, 'limit' | 'offset'>>) {
  const { $api } = useApi()
  return useInfiniteQuery({
    queryKey: computed(() => myTaskKeys.list({ ...myTaskListQuery({ ...toValue(params), limit: MY_TASK_PAGE_SIZE }), pages: true, offset: undefined })),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => $api('/api/v1/my-tasks', {
      query: myTaskListQuery({ ...toValue(params), limit: MY_TASK_PAGE_SIZE, offset: pageParam }),
      schema: MyTaskListPageSchema,
    }),
    getNextPageParam: (last, _pages, lastOffset) => nextOffset({
      offset: lastOffset,
      limit: MY_TASK_PAGE_SIZE,
      total: last.total,
      received: last.items.length,
    }),
  })
}
