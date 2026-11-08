import { computed, type Ref } from 'vue'
import { keepPreviousData, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { TagListSchema, TagSchema, type TagList } from '@liwan/contracts'

export const tagKeys = {
  all: ['tags'] as const,
  list: (q: string) => ['tags', q] as const,
}

/** The tag picker asks for one bounded page per search term. */
export const TAG_PAGE = 100

export function useTags(q: Ref<string>) {
  const { $api } = useApi()
  const query = useInfiniteQuery({
    queryKey: computed(() => tagKeys.list(q.value)),
    placeholderData: keepPreviousData,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => $api('/api/v1/tags', {
      query: { q: q.value || undefined, limit: TAG_PAGE, offset: pageParam },
      schema: TagListSchema,
    }),
    getNextPageParam: (last: TagList, pages: TagList[]) => {
      const loaded = pages.reduce((count, page) => count + page.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
  })
  const items = computed(() => (query.data.value?.pages ?? []).flatMap(page => page.items))
  return { ...query, data: items, items }
}

export function useCreateTag() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (body: { name: string }) => $api('/api/v1/tags', { method: 'POST', body, schema: TagSchema }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tagKeys.all })
    },
  })
}
