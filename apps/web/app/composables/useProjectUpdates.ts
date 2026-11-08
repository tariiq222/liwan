import { computed, type Ref } from 'vue'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { ProjectUpdateListSchema, ProjectUpdateSchema, type ProjectUpdate, type ProjectUpdateBody } from '@liwan/contracts'
import { projectKeys } from './projectKeys'

/** The page size of the project update log; the server caps it at 200. */
export const PROJECT_UPDATE_PAGE = 50

export function useProjectUpdates(projectId: Ref<number | null>) {
  const { $api } = useApi()
  const query = useInfiniteQuery({
    queryKey: computed(() => projectKeys.updates(projectId.value ?? 0)),
    enabled: computed(() => !!projectId.value),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => $api(`/api/v1/projects/${projectId.value}/updates`, {
      query: { limit: PROJECT_UPDATE_PAGE, offset: pageParam },
      schema: ProjectUpdateListSchema,
    }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
  })
  const items = computed<ProjectUpdate[]>(() => (query.data.value?.pages ?? []).flatMap(page => page.items))
  const total = computed(() => query.data.value?.pages.at(-1)?.total ?? 0)
  // `data` is the loaded log, not the page objects: the overview reads one
  // list and only the log view pages.
  return { ...query, data: items, items, total }
}

export function useCreateProjectUpdate() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, body }: { projectId: number; body: ProjectUpdateBody }) =>
      $api(`/api/v1/projects/${projectId}/updates`, { method: 'POST', body, schema: ProjectUpdateSchema }),
    // A posted update starts a new first page, so the log is refetched rather
    // than spliced into the cached pages.
    onSuccess: (_update, { projectId }) => {
      qc.invalidateQueries({ queryKey: projectKeys.updates(projectId) })
      qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) })
      qc.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}
