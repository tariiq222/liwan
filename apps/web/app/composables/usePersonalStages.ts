import { computed } from 'vue'
import { useInfiniteQuery } from '@tanstack/vue-query'
import { PersonalStageListSchema, type PersonalStageList } from '@liwan/contracts'
import { taskKeys } from './useTasks'

/** Personal stages are a fixed, short vocabulary; one page covers every existing user. */
export const PERSONAL_STAGE_PAGE = 200

// Personal stages rarely change within a session, so keep them fresh for
// 5 minutes rather than refetching on every mount.
export function usePersonalStages() {
  const { $api } = useApi()
  const query = useInfiniteQuery({
    queryKey: taskKeys.stages,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => $api('/api/v1/me/personal-stages', {
      query: { limit: PERSONAL_STAGE_PAGE, offset: pageParam },
      schema: PersonalStageListSchema,
    }),
    getNextPageParam: (last: PersonalStageList, pages: PersonalStageList[]) => {
      const loaded = pages.reduce((count, page) => count + page.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
    staleTime: 5 * 60 * 1000,
  })
  const data = computed(() => (query.data.value?.pages ?? []).flatMap(page => page.items))
  return { ...query, data }
}
