import { getCurrentInstance, onMounted, ref, type MaybeRefOrGetter } from 'vue'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  InboxAgentListSchema,
  InboxAttachmentSchema,
  InboxCannedReplyListSchema,
  InboxContactSchema,
  InboxConversationDetailSchema,
  InboxConversationListSchema,
  InboxMessageListSchema,
  InboxMessageSchema,
  InboxTagListSchema,
  InboxTemplateListSchema,
  type InboxContactPatch,
  type InboxMessage,
  type InboxConversationPatch,
  type InboxNoteCreate,
  type InboxReplyCreate,
} from '@liwan/contracts'
import { inboxListQuery, type InboxListRoute } from './inboxListRoute'
import { fileToBase64 } from '../../utils/attachmentFile'
import { createTypingNotifier } from './inboxTyping'
import { ApiError } from '../useApi'
import { busFallbackInterval, useBus } from '../useBus'

// Conversation events refresh lists and the affected thread; template events have their own keys.
export const inboxKeys = {
  all: ['inbox'] as const,
  list: (route: InboxListRoute) => ['inbox', 'conversations', inboxListQuery(route)] as const,
  detail: (id: number) => ['inbox', 'conversation', id] as const,
  messagesOf: (id: number) => ['inbox', 'messages', id] as const,
  canned: ['inbox', 'canned-replies'] as const,
  templates: (channelId: number) => ['inbox', 'templates', channelId] as const,
  templateList: (channelId: number, filters: object) => ['inbox', 'templates', channelId, filters] as const,
  template: (id: number) => ['inbox', 'template', id] as const,
  tags: ['inbox', 'tags'] as const,
  agents: ['inbox', 'agents'] as const,
}

export function useInboxConversations(route: MaybeRefOrGetter<InboxListRoute>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxKeys.list(toValue(route))),
    placeholderData: keepPreviousData,
    retry: false,
    refetchInterval: busFallbackInterval(),
    queryFn: ({ queryKey, signal }) => $api('/api/v1/inbox/conversations', { query: queryKey[2], signal, schema: InboxConversationListSchema }),
  })
}

export function useInboxConversation(id: MaybeRefOrGetter<number | undefined>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxKeys.detail(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    retry: false,
    refetchInterval: busFallbackInterval(),
    queryFn: ({ queryKey, signal }) => $api(`/api/v1/inbox/conversations/${queryKey[2]}`, { signal, schema: InboxConversationDetailSchema }),
  })
}

/** Opening an unread conversation marks it read; a refusal (a read-only tenant) leaves it unread and is not an error to show. */
export function useMarkInboxConversationRead() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => $api(`/api/v1/inbox/conversations/${id}/read`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbox', 'conversations'] }),
  })
}

/** Messages fetched per page; the server clamps a page to 200. */
export const INBOX_MESSAGE_PAGE = 100

type MessagePage = { items: InboxMessage[]; total: number }

/** Pages arrive newest first (offset counts from the newest); the thread reads oldest first. A message that moved between pages while new ones arrived is kept once. */
export function mergeMessagePages(pages: readonly MessagePage[]): InboxMessage[] {
  const seen = new Set<number>()
  const merged: InboxMessage[] = []
  for (const page of [...pages].reverse()) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      merged.push(item)
    }
  }
  return merged
}

/** The offset of the next older page, or undefined when everything is loaded. */
export function nextOlderOffset(pages: readonly MessagePage[]): number | undefined {
  const last = pages.at(-1)
  if (!last) return undefined
  const loaded = pages.reduce((sum, page) => sum + page.items.length, 0)
  return last.items.length > 0 && loaded < last.total ? loaded : undefined
}

/**
 * The conversation's messages, oldest first, newest page first on the wire; `fetchNextPage` loads the next older page.
 * While the bus is disconnected only the newest page is polled, never the history already loaded: a long thread is not
 * re-read every five seconds. A reconnect refreshes the whole query once through the bus's own stale reconciliation.
 */
export function useInboxMessages(id: MaybeRefOrGetter<number | undefined>) {
  const { $api } = useApi()
  const { connected } = useBus()
  // The newest-page poll is a browser fallback: the server-rendered first paint already reads the thread, and a second
  // query there would duplicate page 0 on every server render.
  const mounted = ref(false)
  if (getCurrentInstance()) onMounted(() => { mounted.value = true })
  const query = useInfiniteQuery({
    queryKey: computed(() => inboxKeys.messagesOf(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    retry: false,
    initialPageParam: 0,
    queryFn: ({ pageParam, queryKey, signal }) => $api(`/api/v1/inbox/conversations/${queryKey[2]}/messages`, { signal, query: { limit: INBOX_MESSAGE_PAGE, offset: pageParam }, schema: InboxMessageListSchema }),
    getNextPageParam: (_last, pages) => nextOlderOffset(pages),
  })
  const latest = useQuery({
    queryKey: computed(() => [...inboxKeys.messagesOf(toValue(id) ?? 0), 'latest'] as const),
    enabled: computed(() => !!toValue(id) && mounted.value && !connected.value),
    retry: false,
    refetchInterval: busFallbackInterval(),
    queryFn: ({ queryKey, signal }) => $api(`/api/v1/inbox/conversations/${queryKey[2]}/messages`, { signal, query: { limit: INBOX_MESSAGE_PAGE, offset: 0 }, schema: InboxMessageListSchema }),
  })
  const pages = computed<MessagePage[]>(() => {
    const history = query.data.value?.pages ?? []
    const newest = latest.data.value
    if (connected.value || !mounted.value || !newest || !history.length) return history
    // The polled page replaces the history's first page; older pages are left exactly as loaded.
    return [{ ...newest, total: Math.max(newest.total, history[0]!.total) }, ...history.slice(1)]
  })
  const items = computed(() => mergeMessagePages(pages.value))
  return { ...query, items, latest }
}

export function useInboxCannedReplies() {
  const { $api } = useApi()
  return useQuery({
    queryKey: inboxKeys.canned,
    queryFn: ({ signal }) => $api('/api/v1/inbox/canned-replies', { signal, schema: InboxCannedReplyListSchema }),
  })
}

/** Templates a reply may use: the approved ones, as many as the server returns in one page. */
export const APPROVED_TEMPLATES_QUERY = { status: 'approved', limit: 200 } as const

/** The approved templates of one channel, for a reply after the customer-service window has closed. */
export function useInboxTemplates(channelId: MaybeRefOrGetter<number | undefined>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxKeys.templateList(toValue(channelId) ?? 0, APPROVED_TEMPLATES_QUERY)),
    enabled: computed(() => !!toValue(channelId) && toValue(enabled)),
    queryFn: ({ queryKey, signal }) => $api(`/api/v1/inbox/channels/${queryKey[2]}/templates`, { signal, query: APPROVED_TEMPLATES_QUERY, schema: InboxTemplateListSchema }),
  })
}

/** The tags an agent may put on a conversation (readable with the read capability). */
/** The company's users who may reply: the only valid assignees. */
export function useInboxAgents(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: inboxKeys.agents,
    queryFn: ({ signal }) => $api('/api/v1/inbox/agents', { signal, query: { limit: 200 }, schema: InboxAgentListSchema }),
    enabled: () => toValue(enabled),
  })
}

export function useInboxTags() {
  const { $api } = useApi()
  return useQuery({
    queryKey: inboxKeys.tags,
    queryFn: ({ signal }) => $api('/api/v1/inbox/tags', { signal, schema: InboxTagListSchema }),
  })
}

function useRefreshConversation(id: MaybeRefOrGetter<number>) {
  const qc = useQueryClient()
  return async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: inboxKeys.messagesOf(toValue(id)) }),
      qc.invalidateQueries({ queryKey: ['inbox', 'conversations'] }),
    ])
  }
}

export function useSendInboxReply(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const refresh = useRefreshConversation(id)
  return useMutation({
    mutationFn: (body: InboxReplyCreate) => $api(`/api/v1/inbox/conversations/${toValue(id)}/messages`, { method: 'POST', body, schema: InboxMessageSchema }),
    onSuccess: refresh,
  })
}

export function useSendInboxNote(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const refresh = useRefreshConversation(id)
  return useMutation({
    mutationFn: (body: InboxNoteCreate) => $api(`/api/v1/inbox/conversations/${toValue(id)}/notes`, { method: 'POST', body, schema: InboxMessageSchema }),
    onSuccess: refresh,
  })
}

/** Uploads one file to a conversation as base64 JSON; the answer is what the reply then sends by id. */
export function useUploadInboxFile(conversationId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  return useMutation({
    mutationFn: async (file: File) => $api(`/api/v1/inbox/conversations/${toValue(conversationId)}/uploads`, {
      method: 'POST',
      body: { name: file.name, mimetype: file.type || 'application/octet-stream', data: await fileToBase64(file) },
      schema: InboxAttachmentSchema,
    }),
  })
}

/** The agent's reaction on a message; an empty emoji removes it. */
export function useReactToInboxMessage(conversationId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const refresh = useRefreshConversation(conversationId)
  return useMutation({
    mutationFn: (input: { messageId: number; emoji: string }) => $api(`/api/v1/inbox/messages/${input.messageId}/reaction`, { method: 'POST', body: { emoji: input.emoji }, schema: InboxMessageSchema }),
    onSuccess: refresh,
  })
}

/** Call the returned function on every keystroke: the typing indicator reaches the customer at most every 3 seconds. */
export function useInboxTyping(conversationId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  return createTypingNotifier(() => $api(`/api/v1/inbox/conversations/${toValue(conversationId)}/typing`, { method: 'POST' }))
}

export function useRetryInboxMessage(conversationId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const refresh = useRefreshConversation(conversationId)
  return useMutation({
    mutationFn: (messageId: number) => $api(`/api/v1/inbox/messages/${messageId}/retry`, { method: 'POST', schema: InboxMessageSchema }),
    onSuccess: refresh,
  })
}

/**
 * Assign, move, close, prioritise or tag a conversation; the response replaces the cached detail. The body names the
 * revision the user saw: a conversation changed since answers 409, and the detail is read again so the user sees what won.
 */
export function usePatchInboxConversation(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InboxConversationPatch) => $api(`/api/v1/inbox/conversations/${toValue(id)}`, { method: 'PATCH', body, schema: InboxConversationDetailSchema }),
    onSuccess: async (detail) => {
      qc.setQueryData(inboxKeys.detail(detail.id), detail)
      await qc.invalidateQueries({ queryKey: ['inbox', 'conversations'] })
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 409) await qc.invalidateQueries({ queryKey: inboxKeys.detail(toValue(id)) })
    },
  })
}

export function usePatchInboxContact(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InboxContactPatch) => $api(`/api/v1/inbox/contacts/${toValue(id)}`, { method: 'PATCH', body, schema: InboxContactSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbox'] }),
  })
}
