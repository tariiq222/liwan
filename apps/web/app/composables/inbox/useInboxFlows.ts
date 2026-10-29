import type { MaybeRefOrGetter } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  InboxFlowListSchema,
  InboxFlowPreviewSchema,
  InboxFlowSchema,
  InboxFlowSubmissionListSchema,
  type InboxFlow,
  type InboxFlowCopy,
  type InboxFlowWrite,
} from '@webvue/contracts'

// Queries and mutations of the WhatsApp forms (flows). Every key starts with 'inbox', so the bus invalidation of
// ['inbox'] refreshes them with everything else.
export const inboxFlowKeys = {
  all: ['inbox', 'flows'] as const,
  channel: (channelId: number) => ['inbox', 'flows', 'channel', channelId] as const,
  list: (channelId: number, filters: object) => ['inbox', 'flows', 'channel', channelId, filters] as const,
  flow: (id: number) => ['inbox', 'flows', 'flow', id] as const,
  submissions: (flowId: number, filters: object) => ['inbox', 'flows', 'flow', flowId, 'submissions', filters] as const,
  conversation: (conversationId: number) => ['inbox', 'flows', 'conversation', conversationId] as const,
}

export interface InboxFlowFilters {
  status?: string
  q?: string
  sendable?: boolean
  limit?: number
  offset?: number
}

const cleanFilters = (filters: object) => Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== '' && value !== false))

/** One channel's forms with any status, for the forms page. */
export function useInboxChannelFlows(channelId: MaybeRefOrGetter<number | null>, filters: MaybeRefOrGetter<InboxFlowFilters>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxFlowKeys.list(toValue(channelId) ?? 0, cleanFilters(toValue(filters)))),
    enabled: computed(() => !!toValue(channelId)),
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/channels/${toValue(channelId)}/flows`, { query: cleanFilters(toValue(filters)), schema: InboxFlowListSchema }),
  })
}

/** The forms of a channel that may be sent now (published, not blocked), for the pickers of the composer, rules and templates. */
export const SENDABLE_FLOWS_QUERY = { sendable: true, limit: 200 } as const

export function useInboxSendableFlows(channelId: MaybeRefOrGetter<number | null | undefined>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxFlowKeys.list(toValue(channelId) ?? 0, SENDABLE_FLOWS_QUERY)),
    enabled: computed(() => !!toValue(channelId) && toValue(enabled)),
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/channels/${toValue(channelId)}/flows`, { query: SENDABLE_FLOWS_QUERY, schema: InboxFlowListSchema }),
  })
}

export function useInboxFlow(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxFlowKeys.flow(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/flows/${toValue(id)}`, { schema: InboxFlowSchema }),
  })
}

/** Every write answers the stored form: it replaces the cached one, and the channel's lists are reloaded. */
function useFlowWrite<V>(request: (variables: V) => Promise<InboxFlow>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: request,
    onSuccess: async (flow) => {
      qc.setQueryData(inboxFlowKeys.flow(flow.id), flow)
      await qc.invalidateQueries({ queryKey: inboxFlowKeys.channel(flow.channel.id) })
    },
  })
}

/** Creates a draft on the channel (and in Meta), or replaces the draft `id`. Meta's validation errors come back inside the form. */
export function useSaveInboxFlow(channelId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  return useFlowWrite(({ id, body }: { id?: number; body: InboxFlowWrite }) => id
    ? $api(`/api/v1/inbox/flows/${id}`, { method: 'PATCH', body, schema: InboxFlowSchema })
    : $api(`/api/v1/inbox/channels/${toValue(channelId)}/flows`, { method: 'POST', body, schema: InboxFlowSchema }))
}

export function usePublishInboxFlow() {
  const { $api } = useApi()
  return useFlowWrite((id: number) => $api(`/api/v1/inbox/flows/${id}/publish`, { method: 'POST', schema: InboxFlowSchema }))
}

export function useDeprecateInboxFlow() {
  const { $api } = useApi()
  return useFlowWrite((id: number) => $api(`/api/v1/inbox/flows/${id}/deprecate`, { method: 'POST', schema: InboxFlowSchema }))
}

/** Copies a form into a new draft; the answer is the copy. */
export function useCopyInboxFlow() {
  const { $api } = useApi()
  return useFlowWrite(({ id, body }: { id: number; body: InboxFlowCopy }) => $api(`/api/v1/inbox/flows/${id}/copy`, { method: 'POST', body, schema: InboxFlowSchema }))
}

export function useDeleteInboxFlow(channelId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => $api(`/api/v1/inbox/flows/${id}`, { method: 'DELETE' }),
    onSuccess: async (_, id) => {
      qc.removeQueries({ queryKey: inboxFlowKeys.flow(id) })
      await qc.invalidateQueries({ queryKey: inboxFlowKeys.channel(toValue(channelId)) })
    },
  })
}

/** Status, health and imports from Meta; the channel's forms are reloaded. */
export function useSyncInboxFlows(channelId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => $api(`/api/v1/inbox/channels/${toValue(channelId)}/flows/sync`, { method: 'POST', schema: InboxFlowListSchema }),
    onSettled: () => qc.invalidateQueries({ queryKey: inboxFlowKeys.all }),
  })
}

/** Meta's web preview link of the form (it needs no login and expires). */
export function useInboxFlowPreviewLink() {
  const { $api } = useApi()
  return useMutation({
    mutationFn: (id: number) => $api(`/api/v1/inbox/flows/${id}/preview`, { schema: InboxFlowPreviewSchema }),
  })
}

export interface InboxSubmissionFilters {
  date_from?: string
  date_to?: string
  limit?: number
  offset?: number
}

/** The answers to a form, newest first, filtered by date and paged. */
export function useInboxFlowSubmissions(flowId: MaybeRefOrGetter<number | null>, filters: MaybeRefOrGetter<InboxSubmissionFilters>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxFlowKeys.submissions(toValue(flowId) ?? 0, cleanFilters(toValue(filters)))),
    enabled: computed(() => !!toValue(flowId)),
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/flows/${toValue(flowId)}/submissions`, { query: cleanFilters(toValue(filters)), schema: InboxFlowSubmissionListSchema }),
  })
}

/** The forms a customer completed in this conversation. */
export function useInboxConversationFlowSubmissions(conversationId: MaybeRefOrGetter<number | undefined>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxFlowKeys.conversation(toValue(conversationId) ?? 0)),
    enabled: computed(() => !!toValue(conversationId)),
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/conversations/${toValue(conversationId)}/flow-submissions`, { schema: InboxFlowSubmissionListSchema }),
  })
}
