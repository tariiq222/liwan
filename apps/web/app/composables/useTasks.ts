import type { Ref } from 'vue'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { TaskDetailSchema, TaskListSchema, type Task, type TaskCreate, type TaskDetail, type TaskPatch, type TaskState } from '@nasq/contracts'

export interface TaskListParams {
  closed: boolean
  state?: TaskState[]
  project_id?: number
  q?: string
  sort?: string
}

// Page size for both the infinite list and the offset math in getNextPageParam.
export const PAGE = 50

export const taskKeys = {
  all: ['tasks'] as const,
  list: (p: TaskListParams) => ['tasks', 'list', p] as const,
  detail: (id: number) => ['tasks', 'detail', id] as const,
  timeline: (id: number) => ['tasks', 'timeline', id] as const,
  stages: ['me', 'personal-stages'] as const,
}

// user_ids/tag_ids/personal_stage_type_id patches carry ids only; the caller
// (a picker with the full list of options in memory) supplies the matching
// display objects here so the cache can be updated without a round trip.
export interface Resolved {
  assignees?: Task['assignees']
  tags?: Task['tags']
  personal_stage?: Task['personal_stage']
}

// Pure reducer, exported so it can be unit tested without booting Nuxt/vue-query
// (see __tests__/useTasks.optimistic.test.ts). Works on both a list item
// (Task) and a full TaskDetail thanks to the `T extends Task` generic.
export function applyPatchToTask<T extends Task>(task: T, patch: TaskPatch, resolved: Resolved = {}): T {
  const next: any = { ...task }
  if (patch.name !== undefined) next.name = patch.name
  if (patch.priority !== undefined) next.priority = patch.priority
  if (patch.date_deadline !== undefined) next.date_deadline = patch.date_deadline
  if (patch.user_ids !== undefined && resolved.assignees) next.assignees = resolved.assignees
  if (patch.tag_ids !== undefined && resolved.tags) next.tags = resolved.tags
  if (patch.personal_stage_type_id !== undefined && resolved.personal_stage !== undefined) next.personal_stage = resolved.personal_stage
  // description_html only exists on a TaskDetail; a plain list Task never has it.
  if ('description' in patch && 'description_html' in next) next.description_html = patch.description ?? ''
  if (patch.allocated_hours !== undefined && 'allocated_hours' in next) next.allocated_hours = patch.allocated_hours
  return next
}

export function useTasks(params: Ref<TaskListParams>) {
  const { $api } = useApi()
  return useInfiniteQuery({
    queryKey: computed(() => taskKeys.list(params.value)),
    queryFn: ({ pageParam }) =>
      $api('/api/v1/tasks', {
        query: {
          filter: 'mine',
          closed: params.value.closed ? 1 : 0,
          state: params.value.state?.join(','),
          project_id: params.value.project_id,
          q: params.value.q || undefined,
          sort: params.value.sort,
          limit: PAGE,
          offset: pageParam,
        },
        schema: TaskListSchema,
      }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
  })
}

export function useTask(id: Ref<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => taskKeys.detail(id.value ?? 0)),
    enabled: computed(() => !!id.value),
    queryFn: () => $api(`/api/v1/tasks/${id.value}`, { schema: TaskDetailSchema }),
  })
}

export function useUpdateTask() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: TaskPatch; resolved?: Resolved }) =>
      $api(`/api/v1/tasks/${id}`, { method: 'PATCH', body: patch, schema: TaskDetailSchema }),
    onMutate: async ({ id, patch, resolved }) => {
      await qc.cancelQueries({ queryKey: taskKeys.detail(id) })
      const prevDetail = qc.getQueryData<TaskDetail>(taskKeys.detail(id))
      if (prevDetail) qc.setQueryData(taskKeys.detail(id), applyPatchToTask(prevDetail, patch, resolved))
      const prevLists = qc.getQueriesData<{ pages: { items: Task[]; total: number }[] }>({ queryKey: ['tasks', 'list'] })
      for (const [key, data] of prevLists) {
        if (data) {
          qc.setQueryData(key, {
            ...data,
            pages: data.pages.map((p) => ({ ...p, items: p.items.map((t) => (t.id === id ? applyPatchToTask(t, patch, resolved) : t)) })),
          })
        }
      }
      return { prevDetail, prevLists }
    },
    onError: (_e, { id }, ctx) => {
      if (ctx?.prevDetail) qc.setQueryData(taskKeys.detail(id), ctx.prevDetail)
      for (const [k, d] of ctx?.prevLists ?? []) qc.setQueryData(k, d)
    },
    onSuccess: (detail, { id }) => {
      qc.setQueryData(taskKeys.detail(id), detail)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks', 'list'] }),
  })
}

// Non-optimistic on purpose: a state transition can be rejected by server-side
// workflow rules, so the UI shows a pending state (`isPending`) rather than
// guessing the result and rolling back.
export function useTransitionTask() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, state }: { id: number; state: TaskState }) =>
      $api(`/api/v1/tasks/${id}/transition`, { method: 'POST', body: { state }, schema: TaskDetailSchema }),
    onSuccess: (detail, { id }) => {
      qc.setQueryData(taskKeys.detail(id), detail)
      qc.invalidateQueries({ queryKey: ['tasks', 'list'] })
      qc.invalidateQueries({ queryKey: taskKeys.timeline(id) })
    },
  })
}

// Prev/next for the detail modal: looks across every cached list query
// (the exact cache entry for `params` first — the filter actually visible
// behind the modal — falling back to a broad scan across every cached list
// query only when that exact entry isn't cached, e.g. a direct /tasks/123
// load that never went through the table with these params). Returns the
// neighbouring ids in that list's order; both null when nothing matches or
// the id sits at an end of the list.
export function useTaskSiblings(currentId: Ref<number>, params: Ref<TaskListParams>) {
  const qc = useQueryClient()
  return computed<{ prevId: number | null; nextId: number | null }>(() => {
    const id = currentId.value
    const exact = qc.getQueryData<{ pages: { items: Task[]; total: number }[] }>(taskKeys.list(params.value))
    const candidates = exact
      ? [exact]
      : qc.getQueriesData<{ pages: { items: Task[]; total: number }[] }>({ queryKey: ['tasks', 'list'] }).map(([, data]) => data)
    for (const data of candidates) {
      if (!data) continue
      const items = data.pages.flatMap((p) => p.items)
      const idx = items.findIndex((t) => t.id === id)
      if (idx === -1) continue
      return {
        prevId: idx > 0 ? (items[idx - 1]?.id ?? null) : null,
        nextId: idx < items.length - 1 ? (items[idx + 1]?.id ?? null) : null,
      }
    }
    return { prevId: null, nextId: null }
  })
}

export function useCreateTask() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (body: TaskCreate) => $api('/api/v1/tasks', { method: 'POST', body, schema: TaskDetailSchema }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks', 'list'] })
    },
  })
}
