import type { Ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { TimelineEntrySchema, type TimelineEntry } from '@nasq/contracts'
import { taskKeys } from './useTasks'

const TimelineListSchema = TimelineEntrySchema.array()

export function useTimeline(id: Ref<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => taskKeys.timeline(id.value ?? 0)),
    enabled: computed(() => !!id.value),
    queryFn: () => $api(`/api/v1/tasks/${id.value}/timeline`, { schema: TimelineListSchema }),
  })
}

export function usePostComment() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: string }) =>
      $api(`/api/v1/tasks/${id}/comments`, { method: 'POST', body: { body }, schema: TimelineEntrySchema }),
    onSuccess: (entry, { id }) => {
      const key = taskKeys.timeline(id)
      const prev = qc.getQueryData<TimelineEntry[]>(key)
      qc.setQueryData(key, prev ? [entry, ...prev] : [entry])
    },
  })
}
