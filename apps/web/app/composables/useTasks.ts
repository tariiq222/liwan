import type { Ref } from 'vue'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  TaskDetailSchema,
  TaskListSchema,
  TaskSummarySchema,
  type Task,
  type TaskCreate,
  type TaskDetail,
  type TaskPatch,
  type TaskState,
} from '@webvue/contracts'
import { daysRemaining } from './taskState'
import { ApiError } from './useApi'
import { invalidateProjectCaches } from './projectKeys'
import { taskAttributeQuery, type TaskAssignee, type TaskDeadline, type TaskPriority } from './taskFilterParams'

export interface TaskListParams {
  closed: boolean
  state?: TaskState[]
  project_id?: number
  q?: string
  assignee?: TaskAssignee
  deadline?: TaskDeadline
  priority?: TaskPriority[]
  sort?: string
  // undefined = true: مهامي. false = every task of `project_id` the user can read (project screen).
  mine?: boolean
}

// Page size for both the infinite list and the offset math in getNextPageParam.
export const PAGE = 50

// The list filters that decide which tasks a summary counts: `closed` and paging do not.
export function summaryQuery(p: TaskListParams) {
  return {
    // An `assignee` filter names the people itself, so it replaces the "mine" scope instead of narrowing it.
    filter: p.mine === false || p.assignee !== undefined ? undefined : 'mine',
    state: p.state?.join(','),
    project_id: p.project_id,
    q: p.q || undefined,
    ...taskAttributeQuery(p),
  }
}

export const taskKeys = {
  all: ['tasks'] as const,
  list: (p: TaskListParams) => ['tasks', 'list', p] as const,
  summary: (p: TaskListParams) => ['tasks', 'summary', summaryQuery(p)] as const,
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
  stage?: Task['stage']
  // Only present on a TaskDetail (a plain list Task carries no milestone field).
  milestone?: TaskDetail['milestone']
}

// Pure reducer, exported so it can be unit tested without booting Nuxt/vue-query
// (see __tests__/useTasks.optimistic.test.ts). Works on both a list item
// (Task) and a full TaskDetail thanks to the `T extends Task` generic.
export function applyPatchToTask<T extends Task>(task: T, patch: TaskPatch, resolved: Resolved = {}): T {
  const next: any = { ...task }
  if (patch.name !== undefined) next.name = patch.name
  if (patch.priority !== undefined) next.priority = patch.priority
  if (patch.date_deadline !== undefined) {
    next.date_deadline = patch.date_deadline
    // days_remaining/is_overdue are server-derived from the deadline; an
    // optimistic deadline edit that left them alone showed the *old* badge
    // (e.g. "3 days overdue" on a deadline just moved to next week) until the
    // PATCH response landed. Recompute them from the same helper the badge
    // labels use so the optimistic row is self-consistent.
    const days = daysRemaining(patch.date_deadline)
    next.days_remaining = days
    next.is_overdue = days !== null && days < 0 && !next.is_closed
  }
  if (patch.user_ids !== undefined && resolved.assignees) next.assignees = resolved.assignees
  if (patch.tag_ids !== undefined && resolved.tags) next.tags = resolved.tags
  if (patch.personal_stage_type_id !== undefined && resolved.personal_stage !== undefined) next.personal_stage = resolved.personal_stage
  if (patch.stage_id !== undefined && resolved.stage !== undefined) next.stage = resolved.stage
  // milestone only exists on a TaskDetail, like description_html below.
  if (patch.milestone_id !== undefined && resolved.milestone !== undefined && 'milestone' in next) next.milestone = resolved.milestone
  // description_html only exists on a TaskDetail; a plain list Task never has it.
  // Checked explicitly against undefined (not `'description' in patch`) so a
  // patch that carries `description: undefined` - e.g. a partial object
  // built with all keys present - doesn't clear the field.
  if (patch.description !== undefined && 'description_html' in next) next.description_html = patch.description ?? ''
  if (patch.allocated_hours !== undefined && 'allocated_hours' in next) next.allocated_hours = patch.allocated_hours
  return next
}

/** Every task list and KPI summary is stale after a task changes. */
export function invalidateTaskLists(qc: { invalidateQueries: (filters: { queryKey: readonly unknown[] }) => unknown }) {
  qc.invalidateQueries({ queryKey: ['tasks', 'list'] })
  qc.invalidateQueries({ queryKey: ['tasks', 'summary'] })
  qc.invalidateQueries({ queryKey: ['tasks', 'attention'] })
}

export function useTasks(params: Ref<TaskListParams>) {
  const { $api } = useApi()
  return useInfiniteQuery({
    queryKey: computed(() => taskKeys.list(params.value)),
    queryFn: ({ pageParam }) =>
      $api('/api/v1/tasks', {
        query: {
          ...summaryQuery(params.value),
          closed: params.value.closed ? 1 : 0,
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

// The KPI strip: total/open/overdue/done for the tasks the list filters select (the same keys as `useTasks`).
export function useTaskSummary(params: Ref<TaskListParams>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => taskKeys.summary(params.value)),
    queryFn: () => $api('/api/v1/tasks/summary', { query: summaryQuery(params.value), schema: TaskSummarySchema }),
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

// A failed update rolls the optimistic change back and tells the user why with a toast (the ApiError message).
// A caller that shows the failure itself inline passes `notifyErrors: false` so it is not reported twice.
export function useUpdateTask({ notifyErrors = true }: { notifyErrors?: boolean } = {}) {
  const qc = useQueryClient()
  const { $api } = useApi()
  const { t } = useI18n()
  const toast = useToast()
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
    onError: (error, { id }, ctx) => {
      if (ctx?.prevDetail) qc.setQueryData(taskKeys.detail(id), ctx.prevDetail)
      for (const [k, d] of ctx?.prevLists ?? []) qc.setQueryData(k, d)
      if (notifyErrors) toast.add({ title: error instanceof ApiError ? error.message : t('errors.generic'), color: 'error' })
    },
    onSuccess: (detail, { id }) => {
      qc.setQueryData(taskKeys.detail(id), detail)
    },
    onSettled: () => {
      invalidateTaskLists(qc)
      invalidateProjectCaches(qc)
    },
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
      invalidateTaskLists(qc)
      qc.invalidateQueries({ queryKey: taskKeys.timeline(id) })
      invalidateProjectCaches(qc)
    },
  })
}

// Prev/next for the detail page. Derived from a live `useTasks(params)`
// result rather than an imperative cache read: `getQueryData`/`getQueriesData`
// create no reactive dependency on the query cache, so on a cold direct
// /tasks/{id} load (a shared link — nothing ever populated the list) the old
// computed evaluated once to `{prevId: null, nextId: null}` and never
// re-evaluated when the list arrived. Subscribing to the query instead means
// the panel shares the table's exact cache entry (same key, so no extra
// request when the table is already mounted behind it) and re-renders when it
// fills. Returns the neighbouring ids in that list's order; both null when the
// task isn't in the filtered list or sits at one of its ends.
export function useTaskSiblings(currentId: Ref<number>, params: Ref<TaskListParams>) {
  const { data } = useTasks(params)
  return computed<{ prevId: number | null; nextId: number | null }>(() => {
    const items = (data.value?.pages ?? []).flatMap((p) => p.items)
    const idx = items.findIndex((t) => t.id === currentId.value)
    if (idx === -1) return { prevId: null, nextId: null }
    return {
      prevId: idx > 0 ? (items[idx - 1]?.id ?? null) : null,
      nextId: idx < items.length - 1 ? (items[idx + 1]?.id ?? null) : null,
    }
  })
}

export function useCreateTask() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (body: TaskCreate) => $api('/api/v1/tasks', { method: 'POST', body, schema: TaskDetailSchema }),
    onSuccess: () => {
      invalidateTaskLists(qc)
      invalidateProjectCaches(qc)
    },
  })
}

export function useRequestTaskCompletion() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id }: { id: number }) =>
      $api(`/api/v1/tasks/${id}/completion/request`, { method: 'POST', body: {}, schema: TaskDetailSchema }),
    onSuccess: (detail, { id }) => {
      qc.setQueryData(taskKeys.detail(id), detail)
      invalidateTaskLists(qc)
      invalidateProjectCaches(qc)
    },
  })
}

export function useAcceptTaskCompletion() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, revision }: { id: number; revision: number }) =>
      $api(`/api/v1/tasks/${id}/completion/accept`, { method: 'POST', body: { revision }, schema: TaskDetailSchema }),
    onSuccess: (detail, { id }) => {
      qc.setQueryData(taskKeys.detail(id), detail)
      invalidateTaskLists(qc)
      invalidateProjectCaches(qc)
    },
  })
}

export function useReturnTaskCompletion() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, revision, note }: { id: number; revision: number; note: string }) =>
      $api(`/api/v1/tasks/${id}/completion/return`, { method: 'POST', body: { revision, note }, schema: TaskDetailSchema }),
    onSuccess: (detail, { id }) => {
      qc.setQueryData(taskKeys.detail(id), detail)
      invalidateTaskLists(qc)
      invalidateProjectCaches(qc)
    },
  })
}

export function useWithdrawTaskCompletion() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, revision }: { id: number; revision: number }) =>
      $api(`/api/v1/tasks/${id}/completion/withdraw`, { method: 'POST', body: { revision }, schema: TaskDetailSchema }),
    onSuccess: (detail, { id }) => {
      qc.setQueryData(taskKeys.detail(id), detail)
      invalidateTaskLists(qc)
      invalidateProjectCaches(qc)
    },
  })
}

export function useArchiveTask() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id }: { id: number }) => $api(`/api/v1/tasks/${id}/archive`, { method: 'POST', body: {}, schema: TaskDetailSchema }),
    onSuccess: (detail, { id }) => {
      qc.setQueryData(taskKeys.detail(id), detail)
      invalidateTaskLists(qc)
      invalidateProjectCaches(qc)
    },
  })
}
