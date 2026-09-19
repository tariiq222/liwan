import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { TaskDetailSchema, TaskListSchema, type TaskDetail } from '@nasq/contracts'
import type { Ref } from 'vue'
import { invalidateProjectCaches } from './projectKeys'

const PAGE = 50

interface ArchivedTaskParams {
  project_id?: number
  q?: string
  mine?: boolean
}

export function archivedTaskQuery(params: ArchivedTaskParams, offset: number) {
  return {
    project_id: params.project_id,
    // The API requires an explicit scope. An unscoped archive is the current
    // user's archive; a project-scoped request keeps the project's permitted
    // archive unless the caller explicitly asks for mine.
    filter: params.project_id === undefined || params.mine ? 'mine' : undefined,
    q: params.q || undefined,
    limit: PAGE,
    offset,
  }
}

const archivedTaskKeys = {
  list: (params: ArchivedTaskParams) => ['tasks', 'archived', params] as const,
}

export function useArchivedTasks(params: Ref<ArchivedTaskParams>) {
  const { $api } = useApi()
  return useInfiniteQuery({
    queryKey: computed(() => archivedTaskKeys.list(params.value)),
    queryFn: ({ pageParam }) => $api('/api/v1/tasks/archived', {
      query: archivedTaskQuery(params.value, pageParam),
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
      invalidateProjectCaches(qc)
    },
  })
}
