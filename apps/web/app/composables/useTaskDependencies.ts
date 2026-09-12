import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { DependencyCandidateListSchema, DependencyListSchema, TaskDetailSchema, type TaskDetail } from '@nasq/contracts'
import type { Ref } from 'vue'
import { taskKeys } from './useTasks'
import { invalidateProjectCaches } from './projectKeys'

const PAGE = 50

export const dependencyKeys = {
  detail: (id: number) => ['tasks', 'dependencies', id] as const,
  candidates: (id: number, q: string) => ['tasks', 'dependency-candidates', id, q] as const,
}

export function useTaskDependencies(taskId: Ref<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => dependencyKeys.detail(taskId.value ?? 0)),
    enabled: computed(() => !!taskId.value),
    queryFn: () => $api(`/api/v1/tasks/${taskId.value}/dependencies`, { schema: DependencyListSchema }),
  })
}

export function useTaskDependencyCandidates(taskId: Ref<number | null>, q: Ref<string>) {
  const { $api } = useApi()
  return useInfiniteQuery({
    queryKey: computed(() => dependencyKeys.candidates(taskId.value ?? 0, q.value.trim())),
    enabled: computed(() => !!taskId.value),
    queryFn: ({ pageParam }) => $api(`/api/v1/tasks/${taskId.value}/dependencies/candidates`, {
      query: { q: q.value.trim() || undefined, limit: PAGE, offset: pageParam },
      schema: DependencyCandidateListSchema,
    }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
  })
}

export function useUpdateTaskDependencies() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, ids }: { id: number; ids: number[] }) =>
      $api(`/api/v1/tasks/${id}/dependencies`, { method: 'PUT', body: { ids }, schema: TaskDetailSchema }),
    onSuccess: (detail: TaskDetail, { id }) => {
      qc.setQueryData(taskKeys.detail(id), detail)
      qc.invalidateQueries({ queryKey: dependencyKeys.detail(id) })
      qc.invalidateQueries({ queryKey: ['tasks', 'dependency-candidates', id] })
      qc.invalidateQueries({ queryKey: ['tasks', 'list'] })
      invalidateProjectCaches(qc)
    },
  })
}

