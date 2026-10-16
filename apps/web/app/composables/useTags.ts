import type { Ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { TagSchema } from '@webvue/contracts'

export const tagKeys = {
  all: ['tags'] as const,
  list: (q: string) => ['tags', q] as const,
}

const TagListSchema = TagSchema.array()

export function useTags(q: Ref<string>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => tagKeys.list(q.value)),
    queryFn: () => $api('/api/v1/tags', { query: { q: q.value || undefined }, schema: TagListSchema }),
  })
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
