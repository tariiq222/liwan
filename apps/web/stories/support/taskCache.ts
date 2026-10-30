// Mirrors how the app itself reflects a mutation: TaskTable.vue renders tasks
// from the vue-query cache that useUpdateTask/useTransitionTask write back to
// (taskKeys.detail(id)), so a story's task must come from that same cache
// instead of a static prop, or a successful PATCH/transition never shows up.
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, watch, type Ref } from 'vue'
import type { Task } from '@liwan/contracts'
import { taskKeys } from '../../app/composables/useTasks'
import { taskDetail } from '../fixtures/pmo'

export function useStoryTask(source: () => Task): Ref<Task> {
  const queryClient = useQueryClient()
  const key = computed(() => taskKeys.detail(source().id))
  // Reseeds on every arg change (including Storybook Controls edits), not just id.
  watch(source, (task) => queryClient.setQueryData(key.value, taskDetail({ ...task })), { immediate: true })
  const { data } = useQuery({ queryKey: key, queryFn: () => taskDetail({ ...source() }), staleTime: Infinity })
  return computed(() => data.value ?? source())
}
