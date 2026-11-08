import { computed, type Ref } from 'vue'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { MilestoneListSchema, MilestoneSchema, type Milestone, type MilestonePatch } from '@liwan/contracts'
import { projectKeys } from './projectKeys'

/** The page size of a project's milestones; the server caps it at 200. */
export const MILESTONE_PAGE = 200

export function useMilestones(projectId: Ref<number | null>) {
  const { $api } = useApi()
  const query = useInfiniteQuery({
    queryKey: computed(() => projectKeys.milestones(projectId.value ?? 0)),
    enabled: computed(() => !!projectId.value),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => $api(`/api/v1/projects/${projectId.value}/milestones`, {
      query: { limit: MILESTONE_PAGE, offset: pageParam },
      schema: MilestoneListSchema,
    }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
  })
  const items = computed<Milestone[]>(() => (query.data.value?.pages ?? []).flatMap(page => page.items))
  const total = computed(() => query.data.value?.pages.at(-1)?.total ?? 0)

  /** Load further pages until `id` is in the list, so a deep link to a later page resolves. */
  async function ensureMilestone(id: number): Promise<Milestone | undefined> {
    let found = items.value.find(item => item.id === id)
    while (!found && query.hasNextPage.value && !query.isFetchingNextPage.value) {
      await query.fetchNextPage()
      found = items.value.find(item => item.id === id)
    }
    return found
  }

  // `data` stays the flat list of every loaded milestone: the milestone pickers
  // and detail pages read one list, not pages, and only the list views page.
  return { ...query, data: items, items, total, ensureMilestone }
}

export function useCreateMilestone() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, name, deadline, start_date, deliverables }: {
      projectId: number
      name: string
      deadline?: string | null
      start_date?: string | null
      deliverables?: Array<{ name: string; done: boolean }>
    }) =>
      $api(`/api/v1/projects/${projectId}/milestones`, { method: 'POST', body: { name, deadline, start_date, deliverables }, schema: MilestoneSchema }),
    onSuccess: async (_milestone, { projectId }) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: projectKeys.milestones(projectId) }),
        qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) }),
      ])
    },
  })
}

export function useUpdateMilestone() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, id, patch }: { projectId: number; id: number; patch: MilestonePatch }) =>
      $api(`/api/v1/projects/${projectId}/milestones/${id}`, { method: 'PATCH', body: patch, schema: MilestoneSchema }),
    onSuccess: async (milestone, { projectId }) => {
      // Every loaded page of the milestone list is refreshed by the invalidation
      // below; the cached pages are never patched in place.
      const key = projectKeys.milestones(projectId)
      qc.setQueryData<{ pages: { items: Milestone[]; total: number }[]; pageParams: unknown[] }>(key, current =>
        current && {
          ...current,
          pages: current.pages.map(page => ({
            ...page,
            items: page.items.map(item => item.id === milestone.id ? milestone : item),
          })),
        },
      )
      await Promise.all([
        qc.invalidateQueries({ queryKey: key }),
        qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) }),
      ])
    },
  })
}

export function useDeleteMilestone() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, id }: { projectId: number; id: number }) =>
      $api(`/api/v1/projects/${projectId}/milestones/${id}`, { method: 'DELETE' }),
    onSuccess: (_r, { projectId }) => {
      qc.invalidateQueries({ queryKey: projectKeys.milestones(projectId) })
      qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) })
    },
  })
}
