import type { Ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { ThreadTaskListSchema, TimelineEntrySchema, type TimelineEntry } from '@webvue/contracts'
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

// Relatives a comment may reference with `/`: the task family sharing this conversation.
export function useThreadTasks(id: Ref<number | null>, enabled: Ref<boolean> = ref(true)) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => [...taskKeys.timeline(id.value ?? 0), 'thread-tasks'] as const),
    enabled: computed(() => !!id.value && enabled.value),
    queryFn: () => $api(`/api/v1/tasks/${id.value}/thread-tasks`, { schema: ThreadTaskListSchema }),
  })
}

// The timeline trusts the server to return entries newest-first; usePostComment
// below prepends the newly posted comment onto the cached list on that same
// assumption, so if the server's ordering ever changes this prepend must change too.
export function usePostComment() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, body, mentions = [], taskRefs = [] }: { id: number; body: string; mentions?: number[]; taskRefs?: number[] }) =>
      $api(`/api/v1/tasks/${id}/comments`, { method: 'POST', body: { body, mentions, task_refs: taskRefs }, schema: TimelineEntrySchema }),
    onSuccess: (entry, { id }) => {
      const key = taskKeys.timeline(id)
      const prev = qc.getQueryData<TimelineEntry[]>(key)
      qc.setQueryData(key, prev ? [entry, ...prev] : [entry])
    },
  })
}
