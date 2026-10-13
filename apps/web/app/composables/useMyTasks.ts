import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/vue-query'
import { z } from 'zod'
import {
  ConvertResultSchema,
  ConvertTargetSchema,
  MyTaskListPageSchema,
  PersonalTaskAttachmentSchema,
  PersonalTaskCommentSchema,
  PersonalTaskSchema,
  type PersonalTask,
} from '@nasq/contracts'
import { myTaskKeys } from './myTaskKeys'

type Api = ReturnType<typeof useApi>['$api']

export type MyTaskTransition = 'done' | 'reopen' | 'cancel'
export interface MyTaskListParams {
  q?: string
  closed?: boolean
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
    assigned: p.scope === 'assigned' ? 'me' : undefined,
    created: p.scope === 'created' ? 'me' : undefined,
    sort: p.sort || undefined,
    limit,
    offset,
  }
}

const refreshLists = (qc: QueryClient) => qc.invalidateQueries({ queryKey: myTaskKeys.lists })

// A write answers with the full detail shape: replace the cache entry, then refresh the lists.
async function replaceDetail(qc: QueryClient, task: PersonalTask) {
  qc.setQueryData(myTaskKeys.detail(task.id), task)
  await refreshLists(qc)
  return task
}

export async function createMyTask($api: Api, qc: QueryClient, body: MyTaskCreate) {
  return replaceDetail(qc, await $api('/api/v1/my-tasks', { method: 'POST', body, schema: PersonalTaskSchema }))
}

export async function updateMyTask($api: Api, qc: QueryClient, { id, body }: { id: number; body: MyTaskBody }) {
  return replaceDetail(qc, await $api(`/api/v1/my-tasks/${id}`, { method: 'PATCH', body, schema: PersonalTaskSchema }))
}

// Not optimistic: the cache changes only once the server confirms the transition.
export async function transitionMyTask($api: Api, qc: QueryClient, { id, action }: { id: number; action: MyTaskTransition }) {
  return replaceDetail(qc, await $api(`/api/v1/my-tasks/${id}/${action}`, { method: 'POST', schema: PersonalTaskSchema }))
}

export async function convertMyTask($api: Api, qc: QueryClient, { id, projectId }: { id: number; projectId: number }) {
  const result = await $api(`/api/v1/my-tasks/${id}/convert`, {
    method: 'POST',
    body: { project_id: projectId },
    schema: ConvertResultSchema,
  })
  // The task is a project task now: its personal detail would be a stale copy.
  qc.removeQueries({ queryKey: myTaskKeys.detail(id) })
  await refreshLists(qc)
  return result
}

const validId = (id: MaybeRefOrGetter<number | null>) => computed(() => Number.isInteger(toValue(id)))

export function useMyTaskList(params: MaybeRefOrGetter<MyTaskListParams>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => myTaskKeys.list(myTaskListQuery(toValue(params)))),
    queryFn: () => $api('/api/v1/my-tasks', { query: myTaskListQuery(toValue(params)), schema: MyTaskListPageSchema }),
  })
}

export function useMyTask(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => myTaskKeys.detail(toValue(id))),
    enabled: validId(id),
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
    queryFn: () => $api(`/api/v1/my-tasks/${toValue(id)}/comments`, { schema: z.array(PersonalTaskCommentSchema) }),
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
    queryFn: () => $api(`/api/v1/my-tasks/${toValue(id)}/attachments`, { schema: z.array(PersonalTaskAttachmentSchema) }),
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
    queryFn: () => $api('/api/v1/my-tasks/convert-targets', {
      query: { q: toValue(q).trim() || undefined },
      schema: z.array(ConvertTargetSchema),
    }),
  })
}

export function useConvertMyTask() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (vars: { id: number; projectId: number }) => convertMyTask($api, qc, vars) })
}
