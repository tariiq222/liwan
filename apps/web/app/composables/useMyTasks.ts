import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/vue-query'
import {
  ConvertResultSchema,
  ConvertTargetSchema,
  MyTaskCollectionSchema,
  PersonalTaskAttachmentSchema,
  PersonalTaskCommentSchema,
  PersonalTaskSchema,
  type PersonalTask,
} from '@liwan/contracts'
import { ApiError } from './useApi'
import { myTaskKeys } from './myTaskKeys'

type Api = ReturnType<typeof useApi>['$api']

export type MyTaskTransition = 'done' | 'reopen' | 'cancel' | 'archive' | 'unarchive'
export interface MyTaskListParams {
  q?: string
  closed?: boolean
  /** Only the archived personal tasks (exclusive with `closed`). */
  archived?: boolean
  /** Both roles when omitted. */
  scope?: 'assigned' | 'created'
  sort?: string
  limit?: number
  offset?: number
}
export interface MyTaskBody {
  name?: string
  description?: string
  date_deadline?: string | null
  priority?: 'normal' | 'high'
  assignees?: number[]
}
export interface MyTaskCreate extends MyTaskBody { name: string; parent_id?: number }

const MAX_LIMIT = 100

export function myTaskListQuery(p: MyTaskListParams) {
  const limit = Number.isFinite(p.limit) ? Math.min(Math.max(Math.trunc(p.limit as number), 1), MAX_LIMIT) : MAX_LIMIT
  const offset = Number.isInteger(p.offset) && (p.offset as number) > 0 ? (p.offset as number) : 0
  return {
    q: p.q?.trim() || undefined,
    closed: p.closed ? 1 : 0,
    archived: p.archived ? 1 : undefined,
    assigned: p.scope === 'assigned' ? 'me' : undefined,
    created: p.scope === 'created' ? 'me' : undefined,
    sort: p.sort || undefined,
    limit,
    offset,
  }
}

// The KPI summary counts the same tasks as the lists, so every write refreshes both.
const refreshLists = (qc: QueryClient) =>
  Promise.all([qc.invalidateQueries({ queryKey: myTaskKeys.lists }), qc.invalidateQueries({ queryKey: myTaskKeys.summaries }), qc.invalidateQueries({ queryKey: ['my-tasks', 'attention'] })])

// A write answers with the full detail shape: replace the cache entry, then refresh the lists. A
// sub-task is also listed in its parent's `subtasks`, so the cached parent detail is refreshed too.
async function replaceDetail(qc: QueryClient, task: PersonalTask) {
  qc.setQueryData(myTaskKeys.detail(task.id), task)
  await Promise.all([
    refreshLists(qc),
    task.parent ? qc.invalidateQueries({ queryKey: myTaskKeys.detail(task.parent.id) }) : undefined,
  ])
  return task
}

export async function createMyTask($api: Api, qc: QueryClient, body: MyTaskCreate) {
  return replaceDetail(qc, await $api('/api/v1/my-tasks', { method: 'POST', body, schema: PersonalTaskSchema }))
}

export async function updateMyTask($api: Api, qc: QueryClient, { id, body }: { id: number; body: MyTaskBody }) {
  return replaceDetail(qc, await $api(`/api/v1/my-tasks/${id}`, { method: 'PATCH', body, schema: PersonalTaskSchema }))
}

// Not optimistic: the cache changes only once the server confirms the transition (archive and restore included).
export async function transitionMyTask($api: Api, qc: QueryClient, { id, action }: { id: number; action: MyTaskTransition }) {
  return replaceDetail(qc, await $api(`/api/v1/my-tasks/${id}/${action}`, { method: 'POST', schema: PersonalTaskSchema }))
}

// Sequence: read the parent id from the cached detail first, then cancel in-flight reads of the task,
// then remove its detail/comments/attachments entries, then invalidate lists and the parent. Cancelling
// before removing keeps a mounted page from refetching the now-404 personal detail.
export async function convertMyTask($api: Api, qc: QueryClient, { id, projectId }: { id: number; projectId: number }) {
  const parentId = qc.getQueryData<PersonalTask>(myTaskKeys.detail(id))?.parent?.id
  const result = await $api(`/api/v1/my-tasks/${id}/convert`, {
    method: 'POST',
    body: { project_id: projectId },
    schema: ConvertResultSchema,
  })
  // The task is a project task now: its personal copies would be stale.
  const keys = [myTaskKeys.detail(id), myTaskKeys.comments(id), myTaskKeys.attachments(id)]
  await Promise.all(keys.map(queryKey => qc.cancelQueries({ queryKey, exact: true })))
  for (const queryKey of keys) qc.removeQueries({ queryKey, exact: true })
  await Promise.all([
    refreshLists(qc),
    parentId ? qc.invalidateQueries({ queryKey: myTaskKeys.detail(parentId) }) : undefined,
  ])
  return result
}

const CommentsSchema = MyTaskCollectionSchema(PersonalTaskCommentSchema)
const AttachmentsSchema = MyTaskCollectionSchema(PersonalTaskAttachmentSchema)
const ConvertTargetsSchema = MyTaskCollectionSchema(ConvertTargetSchema)

// Collection reads answer `{ items, total }`; the hooks below expose that envelope as `data`.
export const fetchMyTaskComments = ($api: Api, id: number | null) =>
  $api(`/api/v1/my-tasks/${id}/comments`, { schema: CommentsSchema })
export const fetchMyTaskAttachments = ($api: Api, id: number | null) =>
  $api(`/api/v1/my-tasks/${id}/attachments`, { schema: AttachmentsSchema })
export const fetchConvertTargets = ($api: Api, q: string) =>
  $api('/api/v1/my-tasks/convert-targets', { query: { q: q.trim() || undefined }, schema: ConvertTargetsSchema })

// A missing or foreign personal task answers 404 (403 for a withdrawn permission) and stays so:
// retrying only delays the not-found state. Anything else is retried once, as everywhere.
export const retryMyTask = (failureCount: number, error: unknown) =>
  !(error instanceof ApiError && [403, 404].includes(error.status)) && failureCount < 1

const validId = (id: MaybeRefOrGetter<number | null>) => computed(() => Number.isInteger(toValue(id)))

export function useMyTask(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => myTaskKeys.detail(toValue(id))),
    enabled: validId(id),
    retry: retryMyTask,
    queryFn: () => $api(`/api/v1/my-tasks/${toValue(id)}`, { schema: PersonalTaskSchema }),
  })
}

export function useCreateMyTask() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (body: MyTaskCreate) => createMyTask($api, qc, body) })
}

export function useUpdateMyTask() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (vars: { id: number; body: MyTaskBody }) => updateMyTask($api, qc, vars) })
}

export function useMyTaskTransition() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (vars: { id: number; action: MyTaskTransition }) => transitionMyTask($api, qc, vars) })
}

export function useMyTaskComments(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => myTaskKeys.comments(toValue(id))),
    enabled: validId(id),
    queryFn: () => fetchMyTaskComments($api, toValue(id)),
  })
}

export function usePostMyTaskComment() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: string }) =>
      $api(`/api/v1/my-tasks/${id}/comments`, { method: 'POST', body: { body }, schema: PersonalTaskCommentSchema }),
    onSuccess: (_row, { id }) => qc.invalidateQueries({ queryKey: myTaskKeys.comments(id) }),
  })
}

export function useMyTaskAttachments(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => myTaskKeys.attachments(toValue(id))),
    enabled: validId(id),
    queryFn: () => fetchMyTaskAttachments($api, toValue(id)),
  })
}

// The detail carries `attachment_count`, so an attachment write refreshes the detail too.
function refreshAttachments(qc: QueryClient, id: number) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: myTaskKeys.attachments(id) }),
    qc.invalidateQueries({ queryKey: myTaskKeys.detail(id) }),
  ])
}

export function useUploadMyTaskAttachment() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, name, mimetype, data }: { id: number; name: string; mimetype?: string; data: string }) =>
      $api(`/api/v1/my-tasks/${id}/attachments`, { method: 'POST', body: { name, mimetype, data }, schema: PersonalTaskAttachmentSchema }),
    onSuccess: (_row, { id }) => refreshAttachments(qc, id),
  })
}

export function useDeleteMyTaskAttachment() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, attachmentId }: { id: number; attachmentId: number }) =>
      $api(`/api/v1/my-tasks/${id}/attachments/${attachmentId}`, { method: 'DELETE' }),
    onSuccess: (_row, { id }) => refreshAttachments(qc, id),
  })
}

export function useConvertTargets(q: MaybeRefOrGetter<string>, options: { enabled?: MaybeRefOrGetter<boolean> } = {}) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => myTaskKeys.convertTargets(toValue(q))),
    enabled: computed(() => toValue(options.enabled) ?? true),
    queryFn: () => fetchConvertTargets($api, toValue(q)),
    // Searching must not swap the open picker for a loading state: that unmounts the menu and closes it on the results.
    placeholderData: keepPreviousData,
  })
}

export function useConvertMyTask() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (vars: { id: number; projectId: number }) => convertMyTask($api, qc, vars) })
}
