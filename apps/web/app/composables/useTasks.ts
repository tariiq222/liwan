import type { Ref } from 'vue'
import { hashKey, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  TaskDetailSchema,
  TaskListSchema,
  TaskSummarySchema,
  type Task,
  type TaskCreate,
  type TaskDetail,
  type TaskPatch,
  type TaskState,
} from '@liwan/contracts'
import { daysRemaining } from './taskState'
import { ApiError } from './useApi'
import { invalidateProjectCaches, isTaskDependentProjectKey, projectKeys } from './projectKeys'
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
  // undefined = true: the caller's tasks. false = every task of `project_id` the user can read (project screen).
  mine?: boolean
  // Every task the user can read, across projects (the /tasks list).
  all?: boolean
}

// Page size for both the infinite list and the offset math in getNextPageParam.
export const PAGE = 50

// The list filters that decide which tasks a summary counts: `closed` and paging do not.
export function summaryQuery(p: TaskListParams) {
  return {
    // An `assignee` filter names the people itself, so it replaces the "mine" scope instead of narrowing it.
    filter: p.all ? 'all' : p.mine === false || p.assignee !== undefined ? undefined : 'mine',
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
  if (patch.percent_complete !== undefined && 'percent_complete' in next) next.percent_complete = patch.percent_complete
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
  const qc = useQueryClient()
  const { me } = useMe()
  return useInfiniteQuery({
    queryKey: computed(() => taskKeys.list(params.value)),
    queryFn: async ({ pageParam, queryKey, signal }) => {
      const page = await $api('/api/v1/tasks', {
        query: {
          ...summaryQuery(queryKey[2]),
          closed: queryKey[2].closed ? 1 : 0,
          sort: queryKey[2].sort,
          limit: PAGE,
          offset: pageParam,
        },
        signal,
        schema: TaskListSchema,
      })
      return { ...page, items: page.items.map(row => pendingTask(qc, row, taskIdentity(me.value), queryKey)) }
    },
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
    queryFn: ({ queryKey, signal }) => $api('/api/v1/tasks/summary', { query: queryKey[2], signal, schema: TaskSummarySchema }),
  })
}

export function useTask(id: Ref<number | null>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => taskKeys.detail(id.value ?? 0)),
    enabled: computed(() => !!id.value),
    queryFn: async ({ queryKey, signal }) => pendingTask(qc, await $api(`/api/v1/tasks/${queryKey[2]}`, { signal, schema: TaskDetailSchema }), taskIdentity(me.value), queryKey, (edit, detail) => { edit.detail = detail }),
  })
}

type TaskPages = { pages: { items: Task[]; total: number }[]; pageParams?: unknown[] }
type TaskLayer = { patch: TaskPatch; resolved?: Resolved; result?: TaskDetail; failed?: boolean; complete?: boolean; done: Promise<void>; finish: () => void; acknowledgements: TaskAcknowledgements }
type TaskEdit = { owner: string; currentOwner: () => string; detail?: TaskDetail; rows: Map<string, [readonly unknown[], Task]>; layers: TaskLayer[] }
const taskEdits = new WeakMap<object, Map<number, TaskEdit>>()
const taskWrites = new WeakMap<object, Map<string, Promise<unknown>>>()

// Only plain writes with fully covered cache effects may consume an exact bus acknowledgement.
// This ledger is local to a QueryClient, bounded, and discarded when its socket/session closes.
type TaskAcknowledgement = { id: number; revision: string; fields: Set<string>; owner: string; currentOwner: () => string }
type TaskAcknowledgements = Map<string, TaskAcknowledgement>
const taskAcknowledgements = new WeakMap<object, TaskAcknowledgements>()
const PLAIN_TASK_FIELDS = new Set(['name', 'priority', 'date_deadline'])
const PRECISE_TASK_REVISION = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
const ACKNOWLEDGEMENT_LIMIT = 128

function plainTaskFields(patch: TaskPatch): Set<string> | null {
  const fields = Object.keys(patch).filter(key => patch[key as keyof TaskPatch] !== undefined)
  return fields.length && fields.every(field => PLAIN_TASK_FIELDS.has(field)) ? new Set(fields) : null
}

export function clearTaskWriteAcknowledgements(client: object): void {
  taskAcknowledgements.delete(client)
}

/** A detail GET is deliberately insufficient: only a completed local mutation registers here. */
export async function reconcileTaskWriteEvent(client: object, payload: Record<string, unknown>): Promise<boolean> {
  if (typeof payload.id !== 'number') return false
  const fields = Array.isArray(payload.changed_fields) && payload.changed_fields.every(field => typeof field === 'string')
    ? payload.changed_fields as string[] : []
  const eligible = payload.event === 'updated' && payload.source === 'write'
    && typeof payload.updated_at === 'string' && PRECISE_TASK_REVISION.test(payload.updated_at)
    && fields.some(field => PLAIN_TASK_FIELDS.has(field))
    && fields.every(field => PLAIN_TASK_FIELDS.has(field) || field === 'write_date' || field === 'write_uid')
  const ledger = taskAcknowledgements.get(client)
  if (!ledger) return false
  const consume = () => {
    if (!eligible) return false
    for (const [key, entry] of ledger) {
      if (entry.currentOwner() !== entry.owner) { ledger.delete(key); continue }
      if (entry.id !== payload.id || entry.revision !== payload.updated_at) continue
      ledger.delete(key)
      return fields.every(field => entry.fields.has(field) || field === 'write_date' || field === 'write_uid')
    }
    return false
  }
  if (consume()) return true
  for (;;) {
    if (taskAcknowledgements.get(client) !== ledger) return false
    const edit = taskEdits.get(client)?.get(payload.id)
    if (!edit || edit.currentOwner() !== edit.owner) return false
    const pending = edit.layers.filter(layer => !layer.complete && layer.acknowledgements === ledger)
    if (!pending.length) return false
    // Unknown/comment events also refresh after this row's real pending writes,
    // so a mutation response cannot cancel or overwrite their conservative read.
    await Promise.race(pending.map(layer => layer.done))
    if (consume()) return true
  }
}

function taskIdentity(me: { id: number; company: { id: number } } | null | undefined): string {
  return me ? `${me.company.id}:${me.id}` : 'anonymous'
}

function pendingTask<T extends Task>(qc: object, row: T, owner: string, key: readonly unknown[], captureDetail?: (edit: TaskEdit, detail: T) => void): T {
  const edit = taskEdits.get(qc)?.get(row.id)
  if (!edit || edit.owner !== owner) return row
  if (edit.layers.some(layer => !layer.failed && !layer.result)) {
    // A new filter/detail can load during the write. Keep its authoritative row
    // before overlaying optimism so a later refusal can restore this cache too.
    if (key[1] === 'list') edit.rows.set(hashKey(key), [key, row])
    else if (key[1] === 'detail') captureDetail?.(edit, row)
  }
  return edit.layers.reduce((current, layer) => layer.failed || layer.result ? current : applyPatchToTask(current, layer.patch, layer.resolved), row)
}

/** Preserve row shape: a detail response also carries fields that do not belong to list rows. */
function taskListRow(row: Task, detail: TaskDetail): Task {
  return Object.fromEntries(Object.keys(row).map(key => [key, detail[key as keyof TaskDetail]])) as Task
}

function renderTaskEdit(qc: ReturnType<typeof useQueryClient>, id: number, edit: TaskEdit) {
  const apply = <T extends Task>(base: T, list: boolean): T => edit.layers.reduce((row, layer) => {
    if (layer.failed) return row
    if (layer.result) return (list ? taskListRow(row, layer.result) : layer.result) as T
    return applyPatchToTask(row, layer.patch, layer.resolved)
  }, base)
  if (edit.detail) qc.setQueryData(taskKeys.detail(id), apply(edit.detail, false))
  for (const [key, base] of edit.rows.values()) {
    qc.setQueryData<TaskPages>(key, data => data && ({ ...data, pages: data.pages.map(page => ({ ...page, items: page.items.map(row => row.id === id ? apply(base, true) : row) })) }))
  }
}

/** Only a list whose membership or ordering can change needs its pages replayed. */
function taskPatchAffectsList(p: TaskListParams, patch: TaskPatch): boolean {
  if (!p || typeof p !== 'object') return true
  return p.sort?.includes('write_date') === true
    || (patch.name !== undefined && (!!p.q || p.sort?.includes('name') === true))
    || (patch.priority !== undefined && (!!p.priority?.length || p.sort?.includes('priority') === true))
    || (patch.date_deadline !== undefined && (!!p.deadline || p.sort?.includes('deadline') === true))
    || (patch.stage_id !== undefined && !!p.state?.length)
    || patch.user_ids !== undefined
}

// Independent rows remain optimistic. Writes of the same task serialize on the wire and
// rebase their pending layers, so an older failure cannot restore a newer row's snapshot.
export function useUpdateTask({ notifyErrors = true }: { notifyErrors?: boolean } = {}) {
  const qc = useQueryClient()
  const { $api } = useApi()
  const { t } = useI18n()
  const toast = useToast()
  const { me } = useMe()
  const identity = () => taskIdentity(me.value)
  const cancelListReads = (recovery: Map<string, readonly unknown[]>) => qc.cancelQueries({
    queryKey: ['tasks', 'list'],
    predicate: query => {
      if (query.state.fetchStatus === 'idle') return false
      recovery.set(hashKey(query.queryKey), query.queryKey)
      return true
    },
  })
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: TaskPatch; resolved?: Resolved }) => {
      const writes = taskWrites.get(qc) ?? new Map<string, Promise<unknown>>()
      taskWrites.set(qc, writes)
      const owner = identity()
      const key = `${owner}:${id}`
      const previous = writes.get(key) ?? Promise.resolve()
      const request = previous.catch(() => undefined).then(() => {
        if (identity() !== owner) throw new ApiError(409, 'identity_changed', t('errors.generic'))
        return $api(`/api/v1/tasks/${id}`, { method: 'PATCH', body: patch, schema: TaskDetailSchema })
      })
      writes.set(key, request)
      void request.finally(() => { if (writes.get(key) === request) writes.delete(key) }).catch(() => undefined)
      return request
    },
    onMutate: async ({ id, patch, resolved }) => {
      const owner = identity()
      const cancelledLists = new Map<string, readonly unknown[]>()
      await Promise.all([qc.cancelQueries({ queryKey: taskKeys.detail(id) }), cancelListReads(cancelledLists)])
      if (identity() !== owner) throw new ApiError(409, 'identity_changed', t('errors.generic'))
      const edits = taskEdits.get(qc) ?? new Map<number, TaskEdit>()
      taskEdits.set(qc, edits)
      let edit = edits.get(id)
      if (!edit || edit.owner !== owner) {
        const rows: TaskEdit['rows'] = new Map()
        for (const [key, data] of qc.getQueriesData<TaskPages>({ queryKey: ['tasks', 'list'] })) {
          const row = data?.pages.flatMap(page => page.items).find(row => row.id === id)
          if (row) rows.set(hashKey(key), [key, row])
        }
        edit = { owner, currentOwner: identity, detail: qc.getQueryData<TaskDetail>(taskKeys.detail(id)), rows, layers: [] }
        edits.set(id, edit)
      }
      const acknowledgements = taskAcknowledgements.get(qc) ?? new Map<string, TaskAcknowledgement>()
      taskAcknowledgements.set(qc, acknowledgements)
      let finish!: () => void
      const done = new Promise<void>(resolve => { finish = resolve })
      const layer: TaskLayer = { patch, resolved, done, finish, acknowledgements }
      edit.layers.push(layer)
      renderTaskEdit(qc, id, edit)
      return { edit, layer, owner, cancelledLists }
    },
    onError: (error, { id }, ctx) => {
      if (ctx && ctx.owner !== identity()) return
      if (ctx) { ctx.layer.failed = true; renderTaskEdit(qc, id, ctx.edit) }
      if (notifyErrors) toast.add({ title: error instanceof ApiError ? error.message : t('errors.generic'), color: 'error' })
    },
    onSuccess: (detail, { id }, ctx) => {
      if (ctx && ctx.owner !== identity()) return
      if (ctx) {
        void cancelListReads(ctx.cancelledLists)
        void qc.cancelQueries({ queryKey: taskKeys.detail(id) })
        if (!ctx.edit.detail) ctx.edit.detail = detail
        ctx.layer.result = detail
        renderTaskEdit(qc, id, ctx.edit)
      }
      else qc.setQueryData(taskKeys.detail(id), detail)
    },
    onSettled: (detail, error, { id, patch }, ctx) => {
      const complete = (reconciled: boolean) => {
        if (!ctx) return
        const fields = plainTaskFields(patch)
        if (reconciled && detail && fields && PRECISE_TASK_REVISION.test(detail.updated_at)
          && ctx.owner === identity() && taskAcknowledgements.get(qc) === ctx.layer.acknowledgements) {
          const ledger = ctx.layer.acknowledgements
          ledger.set(`${ctx.owner}:${id}:${detail.updated_at}`, { id, revision: detail.updated_at, fields, owner: ctx.owner, currentOwner: identity })
          while (ledger.size > ACKNOWLEDGEMENT_LIMIT) ledger.delete(ledger.keys().next().value!)
        }
        ctx.layer.complete = true
        ctx.layer.finish()
        if (taskEdits.get(qc)?.get(id) === ctx.edit && ctx.edit.layers.every(layer => layer.complete)) taskEdits.get(qc)?.delete(id)
      }
      if (ctx && ctx.owner !== identity()) { complete(false); return }
      const effects: Array<Promise<unknown>> = []
      const refresh = (filters: Parameters<typeof qc.invalidateQueries>[0]) => { effects.push(qc.invalidateQueries(filters, { throwOnError: true })) }
      // An interrupted warm read may reconcile another task's membership or total.
      // Merge recovery and this patch's required reads so neither cancels its own restart.
      const lists = new Map<string, readonly unknown[]>(ctx?.cancelledLists)
      if (!error) {
        for (const [key] of qc.getQueriesData({ queryKey: ['tasks', 'list'] })) {
          if (taskPatchAffectsList(key[2] as TaskListParams, patch)) lists.set(hashKey(key), key)
        }
      }
      for (const key of lists.values()) refresh({ queryKey: key, exact: true })
      if (error) { void Promise.allSettled(effects).then(() => complete(false)); return }
      if (patch.name !== undefined || patch.priority !== undefined || patch.date_deadline !== undefined || patch.user_ids !== undefined || patch.stage_id !== undefined) {
        refresh({ queryKey: ['tasks', 'summary'] })
        refresh({ queryKey: ['tasks', 'attention'] })
      }
      refresh({ queryKey: taskKeys.timeline(id) })
      const projectIds = detail?.project?.id ? new Set([detail.project.id]) : undefined
      const changedFields = new Set(Object.keys(patch).filter(key => patch[key as keyof TaskPatch] !== undefined))
      refresh({ queryKey: projectKeys.all, predicate: query => isTaskDependentProjectKey(query.queryKey, projectIds, changedFields) })
      // Mark eligibility only after all required reads/invalidation work has settled successfully.
      // The form itself still follows its committed write response.
      void Promise.allSettled(effects).then(results => complete(results.every(result => result.status === 'fulfilled')))
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
// Where the task sits in the list it was opened from: its neighbours, its 1-based position and the list's total.
export function useTaskSiblings(currentId: Ref<number>, params: Ref<TaskListParams>) {
  const { data } = useTasks(params)
  return computed<{ prevId: number | null; nextId: number | null; position: number | null; total: number | null }>(() => {
    const items = (data.value?.pages ?? []).flatMap((p) => p.items)
    const idx = items.findIndex((t) => t.id === currentId.value)
    if (idx === -1) return { prevId: null, nextId: null, position: null, total: null }
    return {
      prevId: idx > 0 ? (items[idx - 1]?.id ?? null) : null,
      nextId: idx < items.length - 1 ? (items[idx + 1]?.id ?? null) : null,
      position: idx + 1,
      total: data.value?.pages[0]?.total ?? items.length,
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
