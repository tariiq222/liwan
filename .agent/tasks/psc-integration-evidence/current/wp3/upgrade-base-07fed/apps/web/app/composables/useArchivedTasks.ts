import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { TaskDetailSchema, TaskListSchema, type TaskDetail } from '@nasq/contracts'
import type { Ref } from 'vue'

const PAGE = 50

export interface ArchivedTaskParams {
  project_id?: number
  q?: string
  mine?: boolean
}

export const archivedTaskKeys = {
  list: (params: ArchivedTaskParams) => ['tasks', 'archived', params] as const,
}

export function useArchivedTasks(params: Ref<ArchivedTaskParams>) {
  const { $api } = useApi()
  return useInfiniteQuery({
    queryKey: computed(() => archivedTaskKeys.list(params.value)),
    queryFn: ({ pageParam }) => $api('/api/v1/tasks/archived', {
      query: {
        project_id: params.value.project_id,
        filter: params.value.mine ? 'mine' : undefined,
        q: params.value.q || undefined,
        limit: PAGE,
        offset: pageParam,
      },
      schema: TaskListSchema,
    }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
  })
}

export function useRestoreTask() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id }: { id: number }) => $api(`/api/v1/tasks/${id}/unarchive`, { method: 'POST', body: {}, schema: TaskDetailSchema }),
    onSuccess: (detail: TaskDetail, { id }) => {
      qc.setQueryData(['tasks', 'detail', id], detail)
      qc.invalidateQueries({ queryKey: ['tasks', 'archived'] })
      qc.invalidateQueries({ queryKey: ['tasks', 'list'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['project'] })
    },
  })
}

